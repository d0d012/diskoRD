import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createKlipyClient, mediaAspectRatio, previewMedia, sendMedia, type KlipyClient, type KlipyItem } from "../../lib/klipy";
import { useAuthStore } from "../../stores/authStore";
import { useGifFavoriteStore } from "../../stores/gifFavoriteStore";
import "./GifPicker.css";

interface Props {
  onSend: (url: string) => Promise<void>;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}
export function GifPicker({ onSend, onClose, triggerRef }: Props) {
  const userId = useAuthStore(s => s.user?.id ?? "");
  const client = useMemo(() => createKlipyClient(userId), [userId]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tab, setTab] = useState<"trending" | "favorites">("trending");
  const root = useRef<HTMLDivElement>(null);
  const load = useGifFavoriteStore(s => s.load);
  const favoriteError = useGifFavoriteStore(s => s.error);
  useEffect(() => { void load().catch(() => {}); }, [load]);
  useEffect(() => {
    // Cancel an old search as soon as typing resumes, not only after the debounce.
    client.abortSearch();
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query, client]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("pointerdown", outside);
      client.abortSearch();
    };
  }, [onClose, triggerRef, client]);
  const waiting = query.trim() !== debounced;
  return (
    <div ref={root} role="dialog" aria-label="GIF picker" className="gif-picker">
      <input autoFocus placeholder="Search KLIPY" aria-label="Search KLIPY" value={query} onChange={e => setQuery(e.target.value)} />
      {!query.trim() && <div className="gif-tabs" role="tablist" aria-label="GIF categories">
        <button role="tab" aria-selected={tab === "trending"} onClick={() => setTab("trending")}>Trending</button>
        <button role="tab" aria-selected={tab === "favorites"} onClick={() => setTab("favorites")}><span aria-hidden="true">★ </span>Favorites</button>
      </div>}
      {favoriteError && <p role="alert" className="gif-status">{favoriteError}</p>}
      {waiting ? <div className="gif-scroll"><Skeletons /></div> : <GifResults key={`${tab}:${debounced}`} client={client} query={debounced} favorites={tab === "favorites" && !debounced} onSend={onSend} />}
      <footer>Powered by KLIPY</footer>
    </div>
  );
}
function Skeletons() {
  return <div className="gif-grid" aria-label="Loading GIFs">{Array.from({ length: 6 }, (_, i) => <div key={i} className="gif-skeleton" style={{ height: i % 2 ? 120 : 150 }} />)}</div>;
}
function GifResults({ client, query, favorites, onSend }: { client: KlipyClient; query: string; favorites: boolean; onSend: Props["onSend"] }) {
  const stored = useGifFavoriteStore(s => s.favorites);
  const load = useGifFavoriteStore(s => s.load);
  const favoriteKey = favorites ? stored.map(f => f.slug).join(",") : "";
  const [items, setItems] = useState<KlipyItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [sending, setSending] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    async function fetchItems() {
      if (favorites) {
        const saved = await load();
        const restored: KlipyItem[] = [];
        for (let i = 0; i < saved.length; i += 50) {
          const batch = saved.slice(i, i + 50);
          const response = await client.items(batch.map(f => f.slug), controller.signal);
          // Provider items may arrive in a different order; our favorites remain newest first.
          for (const f of batch) restored.push(response.find(item => item.slug === f.slug) ?? { slug: f.slug, title: "GIF unavailable", file: {} });
        }
        if (!controller.signal.aborted) { setItems(restored); setHasNext(false); }
      } else {
        const response = query ? await client.search(query, page, controller.signal) : await client.trending(page, controller.signal);
        if (!controller.signal.aborted) { setItems(previous => page === 1 ? response.items : [...previous, ...response.items]); setHasNext(response.hasNext); }
      }
    }
    void fetchItems().catch(() => { if (!controller.signal.aborted) setError("Unable to load GIFs. Please try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client, query, page, favorites, favoriteKey, load, retry]);
  useEffect(() => {
    if (!hasNext || loading || error || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); setPage(p => p + 1); }
    }, { root: scroll.current, rootMargin: "150px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasNext, loading, error]);
  async function send(item: KlipyItem) {
    const media = sendMedia(item);
    if (!media || sending) return;
    setSending(true);
    try {
      await onSend(media.url);
      if (item.slug) void client.share(item.slug, query || undefined).catch(() => {});
    } catch { setError("Unable to send GIF. Please try again."); }
    finally { setSending(false); }
  }
  return <div className="gif-scroll" ref={scroll} aria-busy={loading}>
    <GifMasonry items={items} disabled={sending} onSend={item => void send(item)} />
    {loading && <Skeletons />}
    {!loading && !error && !items.length && <p className="gif-status">{favorites ? "No favorite GIFs yet. Star a GIF to save it." : "No GIFs found."}</p>}
    {error && <div className="gif-status" role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
    <div ref={sentinel} className="h-1" />
  </div>;
}
// Absolute masonry keeps DOM/provider order intact; CSS columns would visually
// rebalance old results into different columns whenever another page arrived.
function GifMasonry({ items, disabled, onSend }: { items: KlipyItem[]; disabled: boolean; onSend: (item: KlipyItem) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(380);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth > 0) setWidth(element.clientWidth); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const columns = [0, 0];
  const tiles = items.map((item, index) => {
    const media = previewMedia(item);
    const column = columns[0] <= columns[1] ? 0 : 1;
    const height = (width - 8) / 2 / mediaAspectRatio(media);
    const top = columns[column];
    columns[column] += height + 8;
    return <div key={`${item.id ?? item.slug ?? "slot"}:${index}`} className="gif-masonry-slot" style={{ top, height, left: column ? "calc((100% + 8px) / 2)" : 0 }}>
      <GifTile item={item} disabled={disabled} onSend={() => onSend(item)} />
    </div>;
  });
  return <div ref={root} className="gif-masonry" style={{ height: Math.max(...columns) }}>{tiles}</div>;
}
function GifTile({ item, disabled, onSend }: { item: KlipyItem; disabled: boolean; onSend: () => void }) {
  const media = previewMedia(item);
  const full = sendMedia(item);
  const favorite = useGifFavoriteStore(s => !!item.slug && s.isFavorite(item.slug));
  const pending = useGifFavoriteStore(s => !!item.slug && s.pending[item.slug]);
  const toggle = useGifFavoriteStore(s => s.toggle);
  const [broken, setBroken] = useState(false);
  return <div className="gif-tile" style={{ aspectRatio: mediaAspectRatio(media) }}>
    <button className="gif-send" aria-label={`Send ${item.title}`} disabled={disabled || !full || broken} onClick={onSend}>
      {media && !broken ? <img src={media.url} width={media.width} height={media.height} alt={item.title} loading="lazy" onError={() => setBroken(true)} /> : <span>{item.title === "GIF" ? "Preview unavailable" : item.title}</span>}
    </button>
    {item.slug && <button className={`gif-star ${favorite ? "is-favorite" : ""}`} aria-pressed={favorite} aria-label={favorite ? "Remove from favorites" : "Add to favorites"} disabled={pending} onClick={e => { e.stopPropagation(); void toggle(item.slug!, full?.width, full?.height).catch(() => {}); }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" /></svg>
    </button>}
  </div>;
}
