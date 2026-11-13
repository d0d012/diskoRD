import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { showcaseOrder, usePixelArtStore } from "../../stores/pixelArtStore";
import { useShowcaseOverlayStore } from "../../stores/showcaseOverlayStore";
import type { PixelArtPiece } from "../../types";
import { ArtThumb } from "./ArtThumb";
import { Icon } from "./Icon";
import { PixelArtEditor } from "./PixelArtEditor";
import { fitScale } from "./decorationImage";
import { SharpArtImage } from "./SharpArtImage";
import { decodeDoc } from "./lib/doc";
import { artToPng, downloadBlob, shareScale } from "./render";
import "./profileArt.css";

/** Tiles shown before "+N"; 5 × 46px fills the card's 252px inner panel. */
const ROW = 5;
const TILE = 46;

interface Props {
  userId: string;
  isSelf: boolean;
  /** Tells the card an overlay (viewer/editor) is open, so it doesn't close on clicks there. */
  onOverlayChange?: (open: boolean) => void;
}

type Overlay =
  | { kind: "viewer"; index: number }
  | { kind: "editor"; piece: PixelArtPiece | null; remix: boolean }
  | null;

/** The "Showcase" block of a profile card: a row of tiles, expandable to the full grid. */
export function ProfileShowcase({ userId, isSelf, onOverlayChange }: Props) {
  const profile = usePixelArtStore((s) => s.profiles[userId]);
  const loadProfile = usePixelArtStore((s) => s.loadProfile);
  const [expanded, setExpanded] = useState(false);
  const [overlay, setOverlayState] = useState<Overlay>(null);

  useEffect(() => {
    loadProfile(userId).catch(() => {});
  }, [userId, loadProfile]);

  function setOverlay(next: Overlay) {
    setOverlayState(next);
    onOverlayChange?.(next !== null);
  }

  const pieces = profile?.showcase ?? [];
  if (!profile) return null;

  const visible = expanded || pieces.length <= ROW ? pieces : pieces.slice(0, ROW - 1);
  const hidden = pieces.length - visible.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold uppercase" style={{ color: "var(--color-dc-header-secondary, var(--color-dc-text-muted))" }}>Showcase</span>
        <div className="flex items-center gap-2">
          {expanded && (
            <button onClick={() => setExpanded(false)} className="text-[11px] hover:underline" style={{ color: "var(--color-dc-text-muted)" }}>Show less</button>
          )}
          {(pieces.length > 0 || !isSelf) && (
            <button
              onClick={() => useShowcaseOverlayStore.getState().open(userId)}
              className="text-[11px] font-semibold hover:underline"
              style={{ color: "var(--color-dc-text-link, #00a8fc)" }}
            >
              {pieces.length > 0 ? "View all →" : "Open →"}
            </button>
          )}
        </div>
      </div>

      {pieces.length === 0 && !isSelf ? (
        <p className="pixel-vitrine rounded-lg px-3 py-4 text-xs" style={{ color: "var(--color-dc-text-muted)" }}>Nothing on display yet.</p>
      ) : pieces.length === 0 ? (
        <button
          onClick={() => setOverlay({ kind: "editor", piece: null, remix: false })}
          className="pixel-vitrine dc-press w-full h-16 rounded-lg flex items-center justify-center gap-1.5 text-xs text-dc-text-muted hover:text-dc-text-normal"
          style={{ border: "1px dashed rgba(255,255,255,0.12)" }}
        >
          <Icon name="brush" size={16} />
          Add your pixel art
        </button>
      ) : (
        <div className="pixel-vitrine grid justify-center gap-1 rounded-lg p-1 -mx-1" style={{ gridTemplateColumns: `repeat(${ROW}, ${TILE}px)` }}>
          {visible.map((piece, i) => (
            <button
              key={piece.id}
              onClick={() => setOverlay({ kind: "viewer", index: i })}
              title={piece.title || "Untitled"}
              aria-label={`View ${piece.title || "untitled pixel art"}`}
              className="pixel-display-tile dc-press rounded-md flex items-center justify-center overflow-hidden"
              style={{ width: TILE, height: TILE }}
            >
              <ArtThumb doc={piece.doc} size={TILE - 6} />
            </button>
          ))}
          {hidden > 0 && (
            <button
              onClick={() => setExpanded(true)}
              aria-label={`Show ${hidden} more`}
              className="dc-press rounded-md border border-white/[0.06] text-sm font-semibold hover:brightness-125"
              style={{ width: TILE, height: TILE, backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-normal)" }}
            >
              +{hidden}
            </button>
          )}
        </div>
      )}

      {overlay?.kind === "viewer" && (
        <ShowcaseViewer
          pieces={pieces}
          index={overlay.index}
          isSelf={isSelf}
          onIndex={(index) => setOverlay({ kind: "viewer", index })}
          onRemix={(piece) => setOverlay({ kind: "editor", piece, remix: !isSelf })}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === "editor" && (
        <PixelArtEditor
          initial={overlay.piece ? {
            art: decodeDoc(overlay.piece.doc),
            title: overlay.piece.title,
            galleryId: overlay.remix ? null : overlay.piece.id,
            remixOf: overlay.remix ? overlay.piece.id : overlay.piece.remixOf,
          } : undefined}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}

function viewerSize(): number {
  return Math.min(window.innerWidth - 160, window.innerHeight - 220, 768);
}

/** Full-size, pixel-perfect view of showcase pieces with prev/next, remix and download. */
export function ShowcaseViewer({ pieces, index, isSelf, onIndex, onRemix, onClose }: {
  pieces: PixelArtPiece[];
  index: number;
  isSelf: boolean;
  onIndex: (index: number) => void;
  onRemix: (piece: PixelArtPiece) => void;
  onClose: () => void;
}) {
  const piece = pieces[index];
  const [box, setBox] = useState(viewerSize);
  const setShowcase = usePixelArtStore((s) => s.setShowcase);
  const gallery = usePixelArtStore((s) => s.gallery);
  const loadGallery = usePixelArtStore((s) => s.loadGallery);

  useEffect(() => {
    const onResize = () => setBox(viewerSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Capture-phase keys so the profile card underneath stays open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowLeft" && index > 0) { e.stopPropagation(); onIndex(index - 1); }
      else if (e.key === "ArrowRight" && index < pieces.length - 1) { e.stopPropagation(); onIndex(index + 1); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, pieces.length, onIndex, onClose]);

  if (!piece) return null;
  const size = piece.doc.width;
  const scale = fitScale(size, size, box, box);
  const px = Math.round(size * scale);

  async function download() {
    try {
      const art = decodeDoc(piece.doc);
      downloadBlob(await artToPng(art, shareScale(art)), `${piece.title || "pixel-art"}.png`);
    } catch {
      // Nothing useful to show; the button simply does nothing on failure.
    }
  }

  /** Owner-only: move the piece one step in the showcase order. */
  async function move(delta: -1 | 1) {
    const all = gallery ?? (await loadGallery());
    const order = showcaseOrder(all);
    const from = order.indexOf(piece.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    await setShowcase(order);
    await usePixelArtStore.getState().loadProfile(piece.ownerId);
    onIndex(to);
  }

  const navButton = "dc-press w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-25 hover:bg-white/10";
  const pill = { color: "var(--color-dc-text-normal)" };

  return createPortal(
    <div
      className="dc-modal-backdrop-in fixed inset-0 z-[10003] flex flex-col items-center justify-center gap-4 p-6"
      style={{ backgroundColor: "rgba(0,0,0,0.88)" }}
      role="dialog"
      aria-modal="true"
      aria-label={piece.title || "Pixel art"}
      data-avatar-lightbox
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex items-center gap-4">
        <button onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous" className={navButton} style={{ color: "#fff" }}>
          <Icon name="chevronLeft" size={28} />
        </button>
        <div className="dc-modal-in rounded-lg overflow-hidden" style={{ width: px, height: px, background: "repeating-conic-gradient(#3a3c42 0% 25%, #2e3035 0% 50%) 0 0 / 24px 24px" }}>
          <SharpArtImage doc={piece.doc} width={px} height={px} alt={piece.title || "Pixel art"} draggable={false} />
        </div>
        <button onClick={() => onIndex(index + 1)} disabled={index === pieces.length - 1} aria-label="Next" className={navButton} style={{ color: "#fff" }}>
          <Icon name="chevronRight" size={28} />
        </button>
      </div>

      <div className="flex flex-col items-center gap-1 text-center" style={{ color: "#fff" }}>
        <div className="text-base font-semibold">{piece.title || "Untitled"}</div>
        <div className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
          {size} × {size} · {index + 1} of {pieces.length}
          {piece.remixAuthor && <> · Remixed from @{piece.remixAuthor.username}</>}
        </div>
      </div>

      <div className="dc-elevated flex items-center gap-2 rounded-full bg-dc-bg-tertiary px-2 py-1 text-sm">
        {isSelf ? (
          <>
            <button onClick={() => void move(-1)} disabled={index === 0} className="dc-press px-3 h-9 rounded-full hover:bg-white/10 disabled:opacity-30" style={pill} title="Show earlier on your profile">← Move</button>
            <button onClick={() => onRemix(piece)} className="dc-press flex items-center gap-1.5 px-3 h-9 rounded-full hover:bg-white/10" style={pill}>
              <Icon name="edit" size={16} /> Edit
            </button>
            <button onClick={() => void move(1)} disabled={index === pieces.length - 1} className="dc-press px-3 h-9 rounded-full hover:bg-white/10 disabled:opacity-30" style={pill} title="Show later on your profile">Move →</button>
          </>
        ) : (
          <button onClick={() => onRemix(piece)} className="dc-btn-primary flex items-center gap-1.5 px-3 h-9 rounded-full font-medium text-white" title="Open a copy in your editor; it credits the artist">
            <Icon name="remix" size={16} /> Remix
          </button>
        )}
        <button onClick={() => void download()} className="dc-press flex items-center gap-1.5 px-3 h-9 rounded-full hover:bg-white/10" style={pill}>
          <Icon name="download" size={16} /> PNG
        </button>
      </div>
    </div>,
    document.body,
  );
}
