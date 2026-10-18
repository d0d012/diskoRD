import { create } from "zustand";
import { api } from "../lib/api";
import type { PixelArtDoc } from "../features/pixelart/lib/doc";
import type { PixelArtPiece, PixelProfile, ProfileBuddy } from "../types";

export const MAX_GALLERY = 50;
export const MAX_SHOWCASE = 15;
export const MAX_BUDDIES = 5;

interface PixelArtStore {
  /** The signed-in user's gallery; null until loaded. */
  gallery: PixelArtPiece[] | null;
  /** Public showcase + buddies per user id, for profile cards. */
  profiles: Record<string, PixelProfile>;

  loadGallery: () => Promise<PixelArtPiece[]>;
  saveArt: (input: { title: string; doc: PixelArtDoc; remixOf?: string | null }) => Promise<PixelArtPiece>;
  updateArt: (id: string, changes: { title?: string; doc?: PixelArtDoc }) => Promise<PixelArtPiece>;
  deleteArt: (id: string) => Promise<void>;
  /** Replaces the showcase with these gallery ids, in order. */
  setShowcase: (ids: string[]) => Promise<void>;
  setBuddies: (buddies: ProfileBuddy[]) => Promise<void>;
  loadProfile: (userId: string) => Promise<PixelProfile>;
  /** PIXEL_PROFILE_UPDATE: refetch a profile someone has open, drop it otherwise. */
  profileChanged: (userId: string, selfId?: string) => void;
}

function showcaseOrder(gallery: PixelArtPiece[]): string[] {
  return gallery
    .filter((a) => a.showcasePosition !== null)
    .sort((a, b) => (a.showcasePosition ?? 0) - (b.showcasePosition ?? 0))
    .map((a) => a.id);
}

export { showcaseOrder };

export const usePixelArtStore = create<PixelArtStore>((set, get) => ({
  gallery: null,
  profiles: {},

  loadGallery: async () => {
    const { data } = await api.get("/users/me/pixel-arts");
    const gallery = (data.data ?? []) as PixelArtPiece[];
    set({ gallery });
    return gallery;
  },

  saveArt: async ({ title, doc, remixOf }) => {
    const { data } = await api.post("/users/me/pixel-arts", { title, doc, remixOf: remixOf ?? null });
    const piece = data.data as PixelArtPiece;
    set((s) => ({ gallery: s.gallery ? [piece, ...s.gallery] : [piece] }));
    return piece;
  },

  updateArt: async (id, changes) => {
    const { data } = await api.patch(`/users/me/pixel-arts/${id}`, changes);
    const piece = data.data as PixelArtPiece;
    set((s) => ({ gallery: s.gallery?.map((a) => (a.id === id ? piece : a)) ?? [piece] }));
    return piece;
  },

  deleteArt: async (id) => {
    await api.delete(`/users/me/pixel-arts/${id}`);
    set((s) => ({ gallery: s.gallery?.filter((a) => a.id !== id) ?? null }));
  },

  setShowcase: async (ids) => {
    await api.put("/users/me/showcase", { ids });
    set((s) => ({
      gallery: s.gallery?.map((a) => {
        const i = ids.indexOf(a.id);
        return { ...a, showcasePosition: i >= 0 ? i : null };
      }) ?? null,
    }));
  },

  setBuddies: async (buddies) => {
    await api.put("/users/me/buddies", { buddies });
  },

  loadProfile: async (userId) => {
    const { data } = await api.get(`/users/${userId}/pixel-profile`);
    const profile = data.data as PixelProfile;
    set((s) => ({ profiles: { ...s.profiles, [userId]: profile } }));
    return profile;
  },

  profileChanged: (userId, selfId) => {
    if (get().profiles[userId]) void get().loadProfile(userId).catch(() => {});
    if (selfId && userId === selfId && get().gallery) void get().loadGallery().catch(() => {});
  },
}));
