export interface KlipyMedia {
  url: string;
  width?: number;
  height?: number;
}
export type KlipySize = Partial<Record<"gif" | "webp" | "jpg" | "mp4" | "webm", KlipyMedia>>;
export interface KlipyItem {
  id?: string | number;
  slug?: string;
  title: string;
  file: Partial<Record<"hd" | "md" | "sm" | "xs", KlipySize>>;
}
export interface KlipyPage {
  items: KlipyItem[];
  currentPage: number;
  hasNext: boolean;
}
const sizes = ["hd", "md", "sm", "xs"] as const;
const formats = ["gif", "webp", "jpg", "mp4", "webm"] as const;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
function dimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
export function parseItem(value: unknown): KlipyItem {
  const raw = record(value);
  const file = record(raw.file);
  const item: KlipyItem = { title: typeof raw.title === "string" ? raw.title : "GIF", file: {} };
  if (typeof raw.id === "string" || typeof raw.id === "number") item.id = raw.id;
  if (typeof raw.slug === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(raw.slug)) item.slug = raw.slug;
  for (const size of sizes) {
    const entry = record(file[size]);
    for (const format of formats) {
      const media = record(entry[format]);
      if (typeof media.url !== "string" || !/^https:\/\//i.test(media.url)) continue;
      item.file[size] ??= {};
      // Never rewrite provider URLs (including signed query parameters).
      item.file[size]![format] = { url: media.url, width: dimension(media.width), height: dimension(media.height) };
    }
  }
  return item;
}
export function parsePage(value: unknown): KlipyPage {
  const raw = record(value);
  if (raw.result === false) throw new Error("KLIPY could not complete the request.");
  const data = record(raw.data);
  return {
    // Keep every result, including non-GIF/advertisement slots, in provider order.
    items: Array.isArray(data.data) ? data.data.map(parseItem) : [],
    currentPage: typeof data.current_page === "number" ? data.current_page : 1,
    hasNext: data.has_next === true,
  };
}
export function mediaAspectRatio(media?: KlipyMedia): number {
  return media?.width && media.height ? media.width / media.height : 4 / 3;
}
export function previewMedia(item: KlipyItem): KlipyMedia | undefined {
  return item.file.sm?.webp ?? item.file.xs?.webp ?? item.file.sm?.gif ?? item.file.xs?.gif
    ?? item.file.md?.webp ?? item.file.md?.gif ?? item.file.hd?.webp ?? item.file.hd?.gif;
}
export function sendMedia(item: KlipyItem): KlipyMedia | undefined {
  for (const size of ["md", "hd", "sm", "xs"] as const) {
    const media = item.file[size]?.gif ?? item.file[size]?.webp;
    if (media) return media;
  }
}
export function isKlipyMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^static[^.]*\.klipy\.com$/i.test(url.hostname) && /\.(gif|webp)(?:$)/i.test(url.pathname);
  } catch { return false; }
}
export function klipyConfigured(): boolean { return Boolean(import.meta.env.VITE_KLIPY_API_KEY?.trim()); }
export async function klipyCustomerId(userId: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
export function createKlipyClient(userId: string, key = import.meta.env.VITE_KLIPY_API_KEY ?? "") {
  let searchController: AbortController | undefined;
  const customer = klipyCustomerId(userId);
  async function request(path: string, params: Record<string, string> = {}, signal?: AbortSignal, body?: Record<string, string>) {
    if (!key.trim()) throw new Error("GIFs not configured");
    const url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const response = await fetch(url.toString(), {
      signal, cache: "no-store", credentials: "omit",
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("Unable to load KLIPY. Please try again.");
    return response.json() as Promise<unknown>;
  }
  async function listing(path: string, page: number, signal?: AbortSignal, q?: string) {
    return parsePage(await request(path, {
      page: String(Math.max(1, page)), per_page: "24", customer_id: await customer,
      locale: (navigator.language || "en").split(/[-_]/)[0], content_filter: "medium", ...(q ? { q } : {}),
    }, signal));
  }
  return {
    trending: (page = 1, signal?: AbortSignal) => listing("trending", page, signal),
    search: (q: string, page = 1, signal?: AbortSignal) => {
      searchController?.abort();
      searchController = new AbortController();
      const combined = signal ? AbortSignal.any([signal, searchController.signal]) : searchController.signal;
      return listing("search", page, combined, q);
    },
    abortSearch: () => searchController?.abort(),
    items: async (slugs: string[], signal?: AbortSignal) => {
      if (slugs.length > 50) throw new Error("KLIPY items batches cannot exceed 50");
      return parsePage(await request("items", { slugs: slugs.join(",") }, signal)).items;
    },
    share: async (slug: string, q?: string) => {
      await request(`share/${encodeURIComponent(slug)}`, {}, undefined, { customer_id: await customer, ...(q ? { q } : {}) });
    },
  };
}
export type KlipyClient = ReturnType<typeof createKlipyClient>;
