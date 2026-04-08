import { create } from "zustand";

export type UserStatus = "online" | "away" | "dnd";

interface NotificationStore {
  status: UserStatus;
  mutedChannels: Set<string>;
  mutedDmUsers: Set<string>;
  setStatus: (s: UserStatus) => void;
  toggleMuteChannel: (channelId: string) => void;
  toggleMuteDmUser: (userId: string) => void;
  isChannelMuted: (channelId: string) => boolean;
  isDmUserMuted: (userId: string) => boolean;
}

interface PersistedPrefs {
  status?: UserStatus;
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

function save(status: UserStatus, mutedChannels: Set<string>, mutedDmUsers: Set<string>) {
  localStorage.setItem(
    "notification_prefs",
    JSON.stringify({
      status,
      mutedChannels: Array.from(mutedChannels),
      mutedDmUsers: Array.from(mutedDmUsers),
    })
  );
}

const prefs = loadPrefs();

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  status: prefs.status ?? "online",
  mutedChannels: new Set(prefs.mutedChannels ?? []),
  mutedDmUsers: new Set(prefs.mutedDmUsers ?? []),

  setStatus: (status) => {
    set((s) => {
      save(status, s.mutedChannels, s.mutedDmUsers);
      return { status };
    });
  },

  toggleMuteChannel: (channelId) => {
    set((s) => {
      const next = new Set(s.mutedChannels);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      save(s.status, next, s.mutedDmUsers);
      return { mutedChannels: next };
    });
  },

  toggleMuteDmUser: (userId) => {
    set((s) => {
      const next = new Set(s.mutedDmUsers);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      save(s.status, s.mutedChannels, next);
      return { mutedDmUsers: next };
    });
  },

  isChannelMuted: (channelId) => get().mutedChannels.has(channelId),
  isDmUserMuted: (userId) => get().mutedDmUsers.has(userId),
}));
