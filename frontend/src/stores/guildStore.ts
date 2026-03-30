import { create } from "zustand";
import { api } from "../lib/api";
import { useMessageStore } from "./messageStore";
import type { Guild, Channel } from "../types";

interface GuildStore {
  guilds: Guild[];
  activeGuildId: string | null;
  channels: Record<string, Channel[]>;
  activeChannelId: string | null;
  setGuilds: (guilds: Guild[]) => void;
  setActiveGuild: (guildId: string | null) => void;
  setChannels: (guildId: string, channels: Channel[]) => void;
  setActiveChannel: (channelId: string) => void;
  fetchGuilds: () => Promise<void>;
  createGuild: (name: string) => Promise<Guild & { channels: Channel[] }>;
  fetchChannels: (guildId: string) => Promise<Channel[]>;
  createInvite: (guildId: string) => Promise<string>;
  createChannel: (guildId: string, name: string, type: "text" | "voice") => Promise<Channel>;
  deleteChannel: (channelId: string, guildId: string) => Promise<void>;
  renameChannel: (channelId: string, guildId: string, name: string) => Promise<void>;
}

export const useGuildStore = create<GuildStore>((set, get) => ({
  guilds: [],
  activeGuildId: null,
  channels: {},
  activeChannelId: null,

  setGuilds: (guilds) => set({ guilds }),

  setActiveGuild: (guildId) => {
    set({ activeGuildId: guildId, activeChannelId: null });
    if (!guildId) return;

    const existing = get().channels[guildId];
    if (existing && existing.length > 0) {
      const first = existing.find((c) => c.type === "text");
      set({ activeChannelId: first?.id ?? null });
    } else {
      api
        .get(`/guilds/${guildId}/channels`)
        .then(({ data }) => {
          const channels: Channel[] = data.data ?? [];
          const firstText = channels.find((c) => c.type === "text");
          if (firstText) useMessageStore.getState().markRead(firstText.id);
          set((s) => ({
            channels: { ...s.channels, [guildId]: channels },
            activeChannelId: firstText?.id ?? null,
          }));
        })
        .catch(() => {});
    }
  },

  setChannels: (guildId, channels) =>
    set((s) => ({ channels: { ...s.channels, [guildId]: channels } })),

  setActiveChannel: (channelId) => {
    set({ activeChannelId: channelId });
    useMessageStore.getState().markRead(channelId);
  },

  fetchGuilds: async () => {
    try {
      const { data } = await api.get("/users/me/guilds");
      set({ guilds: data.data ?? [] });
    } catch {
      // silently fail — user may be on mock account or not yet authenticated
    }
  },

  createGuild: async (name: string) => {
    const { data } = await api.post("/guilds", { name });
    const guild = data.data;
    const channels: Channel[] = guild.channels ?? [];
    set((s) => ({
      guilds: [...s.guilds, guild],
      channels: { ...s.channels, [guild.id]: channels },
    }));
    return guild;
  },

  fetchChannels: async (guildId: string) => {
    try {
      const { data } = await api.get(`/guilds/${guildId}/channels`);
      const channels: Channel[] = data.data ?? [];
      set((s) => ({ channels: { ...s.channels, [guildId]: channels } }));
      return channels;
    } catch {
      return [];
    }
  },

  createInvite: async (guildId: string) => {
    const { data } = await api.post(`/guilds/${guildId}/invites`, {});
    return data.data.code as string;
  },

  createChannel: async (guildId: string, name: string, type: "text" | "voice") => {
    const { data } = await api.post(`/guilds/${guildId}/channels`, { name, type });
    const channel: Channel = data.data;
    set((s) => ({
      channels: {
        ...s.channels,
        [guildId]: [...(s.channels[guildId] ?? []), channel],
      },
    }));
    return channel;
  },

  deleteChannel: async (channelId: string, guildId: string) => {
    await api.delete(`/channels/${channelId}`);
    set((s) => {
      const updated = (s.channels[guildId] ?? []).filter((c) => c.id !== channelId);
      return {
        channels: { ...s.channels, [guildId]: updated },
        activeChannelId: s.activeChannelId === channelId
          ? (updated.find((c) => c.type === "text")?.id ?? null)
          : s.activeChannelId,
      };
    });
  },

  renameChannel: async (channelId: string, guildId: string, name: string) => {
    const { data } = await api.patch(`/channels/${channelId}`, { name });
    const updated: Channel = data.data;
    set((s) => ({
      channels: {
        ...s.channels,
        [guildId]: (s.channels[guildId] ?? []).map((c) =>
          c.id === channelId ? { ...c, name: updated.name } : c
        ),
      },
    }));
  },
}));
