import { create } from "zustand";
import type { Art } from "../features/pixelart/lib/art";

/** A pixel art piece waiting to be dropped somewhere in a channel's history. */
interface DecorationPlacementState {
  channelId: string | null;
  art: Art | null;
  start: (channelId: string, art: Art) => void;
  cancel: () => void;
}

export const useDecorationPlacementStore = create<DecorationPlacementState>((set) => ({
  channelId: null,
  art: null,
  start: (channelId, art) => set({ channelId, art }),
  cancel: () => set({ channelId: null, art: null }),
}));
