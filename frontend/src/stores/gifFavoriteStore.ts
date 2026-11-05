import { create } from "zustand";
import { api } from "../lib/api";
import { useAuthStore } from "./authStore";

export interface GifFavorite {
  slug: string;
  width?: number | null;
  height?: number | null;
  createdAt: string;
}
interface FavoriteState {
  userId: string | null;
  favorites: GifFavorite[];
  loaded: boolean;
  pending: Record<string, boolean>;
  error: string;
  load: () => Promise<GifFavorite[]>;
  toggle: (slug: string, width?: number, height?: number) => Promise<void>;
  isFavorite: (slug: string) => boolean;
}
let loading: { userId: string; promise: Promise<GifFavorite[]> } | undefined;
export const useGifFavoriteStore = create<FavoriteState>((set, get) => ({
  userId: null, favorites: [], loaded: false, pending: {}, error: "",
  load: async () => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return [];
    if (get().userId === userId && get().loaded) return get().favorites;
    if (loading?.userId === userId) return loading.promise;
    set({ userId, favorites: [], loaded: false, error: "" });
    const promise = (async () => {
      const favorites: GifFavorite[] = [];
      let cursor: string | undefined;
      do {
        const { data } = await api.get("/users/me/gif-favorites", { params: { limit: 100, ...(cursor ? { cursor } : {}) } });
        const page = data.data as { items: GifFavorite[]; hasMore: boolean; nextCursor?: string };
        favorites.push(...page.items);
        cursor = page.hasMore ? page.nextCursor : undefined;
      } while (cursor);
      if (useAuthStore.getState().user?.id === userId) set({ userId, favorites, loaded: true });
      return favorites;
    })();
    loading = { userId, promise };
    try { return await promise; }
    catch (error) { if (get().userId === userId) set({ error: "Unable to load GIF favorites." }); throw error; }
    finally { if (loading?.promise === promise) loading = undefined; }
  },
  isFavorite: slug => get().favorites.some(f => f.slug === slug),
  toggle: async (slug, width, height) => {
    await get().load();
    if (get().pending[slug]) return;
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    const previous = get().favorites;
    const existing = previous.find(f => f.slug === slug);
    set({
      favorites: existing ? previous.filter(f => f.slug !== slug) : [{ slug, width, height, createdAt: new Date().toISOString() }, ...previous],
      pending: { ...get().pending, [slug]: true }, error: "",
    });
    try {
      const url = `/users/me/gif-favorites/${encodeURIComponent(slug)}`;
      if (existing) await api.delete(url);
      else await api.put(url, { width, height });
    } catch (error) {
      if (get().userId === userId) {
        // Roll back just this slug; other in-flight toggles must survive.
        const rest = get().favorites.filter(f => f.slug !== slug);
        if (existing) rest.splice(Math.min(previous.indexOf(existing), rest.length), 0, existing);
        const response = (error as { response?: { data?: { error?: string } } }).response;
        set({ favorites: rest, error: response?.data?.error || "Unable to update GIF favorites." });
      }
      throw error;
    } finally {
      if (get().userId === userId) set({ pending: { ...get().pending, [slug]: false } });
    }
  },
}));
// Favorites are private to the signed-in account; never retain them across logout/account switches.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) {
    loading = undefined;
    useGifFavoriteStore.setState({ userId: state.user?.id ?? null, favorites: [], loaded: false, pending: {}, error: "" });
  }
});
