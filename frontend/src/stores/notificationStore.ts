import { create } from "zustand";
import { api } from "../lib/api";
import type { PreferredStatus } from "../types";

interface NotificationStore {
  /** The user's chosen status. The server is the source of truth. */
  status: PreferredStatus;
  /** Transient message shown when a status change fails. */
  statusError: string | null;
  mutedChannels: Set<string>;
  mutedDmUsers: Set<string>;
  /** Updates optimistically and reverts if the server rejects the change. */
  setStatus: (s: PreferredStatus) => Promise<void>;
  clearStatusError: () => void;
  /** Applies the server's authoritative status (READY.me / USER_UPDATE self). */
  syncStatus: (s: PreferredStatus | undefined) => void;
  toggleMuteChannel: (channelId: string) => void;
  toggleMuteDmUser: (userId: string) => void;
  isChannelMuted: (channelId: string) => boolean;
  isDmUserMuted: (userId: string) => boolean;
}

interface PersistedPrefs {
  mutedChannels?: string[];
  mutedDmUsers?: string[];
}

function loadPrefs(): PersistedPrefs {
  try {
    const raw = localStorage.getItem("notification_prefs");
    return raw ? (JSON.parse(raw) as PersistedPrefs) : {};
  } catch {
    return {};
  }
}

function save(mutedChannels: Set<string>, mutedDmUsers: Set<string>) {
  try {
    localStorage.setItem(
      "notification_prefs",
      JSON.stringify({
        mutedChannels: Array.from(mutedChannels),
        mutedDmUsers: Array.from(mutedDmUsers),
      })
    );
  } catch {
    // Storage unavailable (private mode, quota) — mutes simply won't persist.
  }
}

const prefs = loadPrefs();

// Monotonic id for status writes. A failed request only reverts while it is
// still the newest intent; a later pick or a server sync wins.
let statusGeneration = 0;

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  status: "online",
  statusError: null,
  mutedChannels: new Set(prefs.mutedChannels ?? []),
  mutedDmUsers: new Set(prefs.mutedDmUsers ?? []),

  setStatus: async (status) => {
    const generation = ++statusGeneration;
    const previous = get().status;
    set({ status });
    try {
      await api.put("/users/me/presence", { status });
      if (statusGeneration === generation) set({ statusError: null });
    } catch (err) {
      // Only the newest intent may revert or raise an error; a stale request
      // finishing late must not clobber a newer selection or its toast.
      if (statusGeneration === generation) {
        set({ status: previous, statusError: "Couldn't update your status" });
      }
      throw err;
    }
  },

  clearStatusError: () => set({ statusError: null }),

  syncStatus: (status) => {
    if (status) {
      statusGeneration++;
      set({ status });
    }
  },

  toggleMuteChannel: (channelId) => {
    set((s) => {
      const next = new Set(s.mutedChannels);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      save(next, s.mutedDmUsers);
      return { mutedChannels: next };
    });
  },

  toggleMuteDmUser: (userId) => {
    set((s) => {
      const next = new Set(s.mutedDmUsers);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      save(s.mutedChannels, next);
      return { mutedDmUsers: next };
    });
  },

  isChannelMuted: (channelId) => get().mutedChannels.has(channelId),
  isDmUserMuted: (userId) => get().mutedDmUsers.has(userId),
}));
