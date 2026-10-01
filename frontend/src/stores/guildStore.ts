import { create } from "zustand";
import { api } from "../lib/api";
import { useMessageStore } from "./messageStore";
import type { Guild, Channel, GuildRole } from "../types";

interface GuildStore {
  guilds: Guild[];
  activeGuildId: string | null;
  channels: Record<string, Channel[]>;
  activeChannelId: string | null;
  roles: Record<string, GuildRole[]>; // guildId → roles sorted by position desc
  setGuilds: (guilds: Guild[]) => void;
  setActiveGuild: (guildId: string | null) => void;
  setChannels: (guildId: string, channels: Channel[]) => void;
  setActiveChannel: (channelId: string) => void;
  fetchGuilds: () => Promise<void>;
  createGuild: (name: string) => Promise<Guild & { channels: Channel[] }>;
  updateGuild: (guildId: string, patch: Partial<Pick<Guild, "name" | "iconUrl">>) => Promise<Guild>;
  deleteGuild: (guildId: string) => Promise<void>;
  fetchChannels: (guildId: string) => Promise<Channel[]>;
  createInvite: (guildId: string) => Promise<string>;
  createChannel: (guildId: string, name: string, type: "text" | "voice") => Promise<Channel>;
  deleteChannel: (channelId: string, guildId: string) => Promise<void>;
  renameChannel: (channelId: string, guildId: string, name: string) => Promise<void>;
  // Roles
  fetchRoles: (guildId: string) => Promise<void>;
  createRole: (guildId: string, name: string, color: string, hoist: boolean) => Promise<GuildRole>;
  updateRole: (guildId: string, roleId: string, patch: Partial<{ name: string; color: string; position: number; hoist: boolean }>) => Promise<void>;
  deleteRole: (guildId: string, roleId: string) => Promise<void>;
  reorderRoles: (guildId: string, updates: { id: string; position: number }[]) => Promise<void>;
  assignRole: (guildId: string, userId: string, roleId: string) => Promise<void>;
  removeRole: (guildId: string, userId: string, roleId: string) => Promise<void>;
  // Real-time updates from gateway
  upsertGuild: (guild: Guild) => void;
  removeGuildById: (guildId: string) => void;
  upsertChannel: (channel: Channel) => void;
  removeChannelById: (guildId: string, channelId: string) => void;
  upsertRole: (guildId: string, role: GuildRole) => void;
  removeRoleById: (guildId: string, roleId: string) => void;
}

export const useGuildStore = create<GuildStore>((set, get) => ({
  guilds: [],
  activeGuildId: null,
  channels: {},
  activeChannelId: null,
  roles: {},

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

  updateGuild: async (guildId: string, patch) => {
    const { data } = await api.patch(`/guilds/${guildId}`, patch);
    const guild: Guild = data.data;
    get().upsertGuild(guild);
    return guild;
  },

  deleteGuild: async (guildId: string) => {
    await api.delete(`/guilds/${guildId}`);
    set((s) => {
      const { [guildId]: _removed, ...remainingChannels } = s.channels;
      const { [guildId]: _removedRoles, ...remainingRoles } = s.roles;
      return {
        guilds: s.guilds.filter((g) => g.id !== guildId),
        activeGuildId: s.activeGuildId === guildId ? null : s.activeGuildId,
        activeChannelId: s.activeGuildId === guildId ? null : s.activeChannelId,
        channels: remainingChannels,
        roles: remainingRoles,
      };
    });
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
    // The CHANNEL_CREATE gateway event may already have added it — upsert, don't append.
    get().upsertChannel(channel);
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

  fetchRoles: async (guildId: string) => {
    const { data } = await api.get(`/guilds/${guildId}/roles`);
    const roles: GuildRole[] = data.data ?? [];
    set((s) => ({ roles: { ...s.roles, [guildId]: roles } }));
  },

  createRole: async (guildId: string, name: string, color: string, hoist: boolean) => {
    const { data } = await api.post(`/guilds/${guildId}/roles`, { name, color, hoist });
    const role: GuildRole = data.data;
    set((s) => ({
      roles: { ...s.roles, [guildId]: [...(s.roles[guildId] ?? []), role] },
    }));
    return role;
  },

  updateRole: async (guildId: string, roleId: string, patch) => {
    const { data } = await api.patch(`/guilds/${guildId}/roles/${roleId}`, patch);
    const updated: GuildRole = data.data;
    set((s) => ({
      roles: {
        ...s.roles,
        [guildId]: (s.roles[guildId] ?? []).map((r) => r.id === roleId ? { ...r, ...updated } : r),
      },
    }));
  },

  deleteRole: async (guildId: string, roleId: string) => {
    await api.delete(`/guilds/${guildId}/roles/${roleId}`);
    set((s) => ({
      roles: {
        ...s.roles,
        [guildId]: (s.roles[guildId] ?? []).filter((r) => r.id !== roleId),
      },
    }));
  },

  reorderRoles: async (guildId: string, updates) => {
    await api.put(`/guilds/${guildId}/roles/reorder`, { roles: updates });
    set((s) => {
      const existing = s.roles[guildId] ?? [];
      const posMap = Object.fromEntries(updates.map((u) => [u.id, u.position]));
      const reordered = existing
        .map((r) => posMap[r.id] !== undefined ? { ...r, position: posMap[r.id] } : r)
        .sort((a, b) => b.position - a.position);
      return { roles: { ...s.roles, [guildId]: reordered } };
    });
  },

  assignRole: async (guildId: string, userId: string, roleId: string) => {
    await api.put(`/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  },

  removeRole: async (guildId: string, userId: string, roleId: string) => {
    await api.delete(`/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  },

  upsertGuild: (guild: Guild) => {
    set((s) => {
      const idx = s.guilds.findIndex((g) => g.id === guild.id);
      const guilds = idx >= 0
        ? s.guilds.map((g) => g.id === guild.id ? { ...g, ...guild } : g)
        : [guild, ...s.guilds];
      return { guilds };
    });
  },

  removeGuildById: (guildId: string) => {
    set((s) => {
      for (const channel of s.channels[guildId] ?? []) {
        useMessageStore.getState().clearChannel(channel.id);
      }
      const { [guildId]: _removedChannels, ...remainingChannels } = s.channels;
      const { [guildId]: _removedRoles, ...remainingRoles } = s.roles;
      return {
        guilds: s.guilds.filter((g) => g.id !== guildId),
        activeGuildId: s.activeGuildId === guildId ? null : s.activeGuildId,
        activeChannelId: s.activeGuildId === guildId ? null : s.activeChannelId,
        channels: remainingChannels,
        roles: remainingRoles,
      };
    });
  },

  upsertChannel: (channel: Channel) => {
    set((s) => {
      const existing = s.channels[channel.guildId] ?? [];
      const idx = existing.findIndex((c) => c.id === channel.id);
      const updated = idx >= 0
        ? existing.map((c) => c.id === channel.id ? channel : c)
        : [...existing, channel];
      return {
        channels: {
          ...s.channels,
          [channel.guildId]: updated.sort((a, b) => a.position - b.position),
        },
      };
    });
  },

  removeChannelById: (guildId: string, channelId: string) => {
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

  upsertRole: (guildId: string, role: GuildRole) => {
    set((s) => {
      const existing = s.roles[guildId] ?? [];
      const idx = existing.findIndex((r) => r.id === role.id);
      const updated = idx >= 0
        ? existing.map((r) => r.id === role.id ? role : r)
        : [...existing, role];
      return { roles: { ...s.roles, [guildId]: updated.sort((a, b) => b.position - a.position) } };
    });
  },

  removeRoleById: (guildId: string, roleId: string) => {
    set((s) => ({
      roles: {
        ...s.roles,
        [guildId]: (s.roles[guildId] ?? []).filter((r) => r.id !== roleId),
      },
    }));
  },
}));
