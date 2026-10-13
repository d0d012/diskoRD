import { create } from "zustand";

interface MessageMenuState {
  /** The message whose context menu is open, if any. Only one can be open at a time. */
  openId: string | null;
  x: number;
  y: number;
  open: (messageId: string, x: number, y: number) => void;
  close: () => void;
}

export const useMessageMenuStore = create<MessageMenuState>((set) => ({
  openId: null,
  x: 0,
  y: 0,
  open: (messageId, x, y) => set({ openId: messageId, x, y }),
  close: () => set({ openId: null }),
}));
