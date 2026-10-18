import { create } from "zustand";

/** Which user's showcase museum is open (one at a time, app-wide). */
interface ShowcaseOverlayState {
  userId: string | null;
  open: (userId: string) => void;
  close: () => void;
}

export const useShowcaseOverlayStore = create<ShowcaseOverlayState>((set) => ({
  userId: null,
  open: (userId) => set({ userId }),
  close: () => set({ userId: null }),
}));
