import { create } from "zustand";

interface PresenceStore {
  statuses: Record<string, string>; // userId → "online" | "offline"
  setStatus: (userId: string, status: string) => void;
  setStatuses: (statuses: Record<string, string>) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  statuses: {},
  setStatus: (userId, status) =>
    set((s) => ({ statuses: { ...s.statuses, [userId]: status } })),
  setStatuses: (incoming) =>
    set((s) => ({ statuses: { ...s.statuses, ...incoming } })),
}));
