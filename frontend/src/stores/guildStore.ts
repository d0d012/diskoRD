import { create } from "zustand";
import type { Guild, Channel } from "../types";

interface GuildStore {
  guilds: Guild[];
  activeGuildId: string | null;
  channels: Record<string, Channel[]>; // guildId -> channels
  activeChannelId: string | null;
  setGuilds: (guilds: Guild[]) => void;
  setActiveGuild: (guildId: string) => void;
  setChannels: (guildId: string, channels: Channel[]) => void;
  setActiveChannel: (channelId: string) => void;
}

export const useGuildStore = create<GuildStore>((set) => ({
  guilds: [],
  activeGuildId: null,
  channels: {},
  activeChannelId: null,

  setGuilds: (guilds) => set({ guilds }),
  setActiveGuild: (guildId) => set({ activeGuildId: guildId, activeChannelId: null }),
  setChannels: (guildId, channels) =>
    set((s) => ({ channels: { ...s.channels, [guildId]: channels } })),
  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),
}));
