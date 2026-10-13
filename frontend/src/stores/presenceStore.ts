import { create } from "zustand";
import type { PresenceStatus } from "../types";

interface PresenceStore {
  statuses: Record<string, PresenceStatus>;
  /** User IDs covered by the last READY presence snapshot (guild audience). */
  guildAudience: Set<string>;
  setStatus: (userId: string, status: PresenceStatus) => void;
  setStatuses: (statuses: Record<string, PresenceStatus>) => void;
  setGuildAudience: (userIds: string[]) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  statuses: {},
  guildAudience: new Set(),
  setStatus: (userId, status) =>
    set((s) => ({ statuses: { ...s.statuses, [userId]: status } })),
  setStatuses: (incoming) =>
    set((s) => ({ statuses: { ...s.statuses, ...incoming } })),
  setGuildAudience: (userIds) => set({ guildAudience: new Set(userIds) }),
}));
