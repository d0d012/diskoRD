import { create } from "zustand";
import type { PublicUser } from "../types";

interface UserStore {
  users: Record<string, PublicUser>;
  upsertUser: (user: Partial<PublicUser> & { id: string }) => void;
  upsertMany: (users: Array<Partial<PublicUser> & { id: string }> | undefined | null) => void;
}

export const useUserStore = create<UserStore>((set) => ({
  users: {},

  upsertUser: (user) => {
    if (!user?.id) return;
    set((s) => ({ users: { ...s.users, [user.id]: { ...s.users[user.id], ...user } } }));
  },

  upsertMany: (users) => {
    if (!users || users.length === 0) return;
    set((s) => {
      const next = { ...s.users };
      for (const u of users) {
        if (!u?.id) continue;
        next[u.id] = { ...next[u.id], ...u };
      }
      return { users: next };
    });
  },
}));
