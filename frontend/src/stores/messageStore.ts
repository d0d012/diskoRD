import { create } from "zustand";
import { api } from "../lib/api";
import { useAuthStore } from "./authStore";
import type { Message } from "../types";

interface TypingUser {
  userId: string;
  username: string;
  at: number;
}

interface MessageStore {
  messages: Record<string, Message[]>;
  hasMore: Record<string, boolean>;
  typingUsers: Record<string, TypingUser[]>;
  unreadChannels: Record<string, boolean>; // channelId → has unread
  unreadCounts: Record<string, number>;    // channelId → unread message count
  channelGuilds: Record<string, string>;   // channelId → guildId (learned from incoming messages)
  mentionCounts: Record<string, number>;   // channelId → mention count

  fetchMessages: (channelId: string, beforeId?: string) => Promise<void>;
  prependMessages: (channelId: string, msgs: Message[], hasMore: boolean) => void;
  addMessage: (msg: Message, activeChannelId: string | null, currentUserId?: string) => void;
  updateMessage: (msg: Message) => void;
  removeMessage: (messageId: string, channelId: string) => void;
  sendMessage: (channelId: string, content: string) => Promise<void>;
  uploadImage: (channelId: string, file: File, caption?: string) => Promise<void>;
  editMessage: (messageId: string, channelId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string, channelId: string) => Promise<void>;
  addReaction: (messageId: string, channelId: string, reaction: { emoji: string; count: number; selfReacted: boolean }) => void;
  removeReaction: (messageId: string, channelId: string, emoji: string, userId: string) => void;
  toggleReaction: (messageId: string, channelId: string, emoji: string) => Promise<void>;
  setTyping: (channelId: string, user: TypingUser) => void;
  clearTyping: (channelId: string, userId: string) => void;
  markRead: (channelId: string) => void;
  clearChannel: (channelId: string) => void;
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: {},
  hasMore: {},
  typingUsers: {},
  unreadChannels: {},
  unreadCounts: {},
  channelGuilds: {},
  mentionCounts: {},

  fetchMessages: async (channelId, beforeId) => {
    const params: Record<string, string> = { limit: "50" };
    if (beforeId) params.before = beforeId;

    const { data } = await api.get(`/channels/${channelId}/messages`, { params });
    const page = data.data as { items: Message[]; hasMore: boolean };

    if (beforeId) {
      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: [...page.items, ...(s.messages[channelId] ?? [])],
        },
        hasMore: { ...s.hasMore, [channelId]: page.hasMore },
      }));
    } else {
      set((s) => ({
        messages: { ...s.messages, [channelId]: page.items },
        hasMore: { ...s.hasMore, [channelId]: page.hasMore },
      }));
    }
  },

  prependMessages: (channelId, msgs, hasMore) => {
    set((s) => ({
      messages: {
        ...s.messages,
        [channelId]: [...msgs, ...(s.messages[channelId] ?? [])],
      },
      hasMore: { ...s.hasMore, [channelId]: hasMore },
    }));
  },

  addMessage: (msg, activeChannelId, currentUserId) => {
    set((s) => {
      const existing = s.messages[msg.channelId] ?? [];
      if (existing.some((m) => m.id === msg.id)) {
        return {
          messages: {
            ...s.messages,
            [msg.channelId]: existing.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)),
          },
        };
      }

      const isActive = msg.channelId === activeChannelId;

      const isOwnMessage = !!currentUserId && msg.author?.id === currentUserId;

      // Mark unread if not in the active channel and not authored by the current user
      const shouldMarkUnread = !isActive && !isOwnMessage;
      const unread = shouldMarkUnread
        ? { ...s.unreadChannels, [msg.channelId]: true }
        : s.unreadChannels;
      const unreadCounts = shouldMarkUnread
        ? { ...s.unreadCounts, [msg.channelId]: (s.unreadCounts[msg.channelId] ?? 0) + 1 }
        : s.unreadCounts;

      // Track mention count
      const isMentioned = shouldMarkUnread && !!currentUserId && (msg.mentions ?? []).includes(currentUserId);
      const mentionCounts = isMentioned
        ? { ...s.mentionCounts, [msg.channelId]: (s.mentionCounts[msg.channelId] ?? 0) + 1 }
        : s.mentionCounts;

      // Clear typing for the message author
      const typing = (s.typingUsers[msg.channelId] ?? []).filter(
        (u) => u.userId !== msg.author?.id
      );

      const channelGuilds =
        msg.guildId && s.channelGuilds[msg.channelId] !== msg.guildId
          ? { ...s.channelGuilds, [msg.channelId]: msg.guildId }
          : s.channelGuilds;

      return {
        channelGuilds,
        messages: { ...s.messages, [msg.channelId]: [...existing, msg] },
        unreadChannels: unread,
        unreadCounts,
        mentionCounts,
        typingUsers: { ...s.typingUsers, [msg.channelId]: typing },
      };
    });
  },

  updateMessage: (msg) => {
    set((s) => {
      const msgs = s.messages[msg.channelId];
      if (!msgs) return s;
      return {
        messages: {
          ...s.messages,
          [msg.channelId]: msgs.map((m) => (m.id === msg.id ? msg : m)),
        },
      };
    });
  },

  removeMessage: (messageId, channelId) => {
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return {
        messages: {
          ...s.messages,
          [channelId]: msgs.filter((m) => m.id !== messageId),
        },
      };
    });
  },

  sendMessage: async (channelId, content) => {
    await api.post(`/channels/${channelId}/messages`, { content });
  },

  uploadImage: async (channelId, file, caption = "") => {
    const form = new FormData();
    form.append("file", file);
    form.append("caption", caption);
    await api.post(`/channels/${channelId}/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  editMessage: async (messageId, _channelId, content) => {
    await api.patch(`/messages/${messageId}`, { content });
  },

  deleteMessage: async (messageId, channelId) => {
    await api.delete(`/messages/${messageId}`);
    get().removeMessage(messageId, channelId);
  },

  addReaction: (messageId, channelId, reaction) => {
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return {
        messages: {
          ...s.messages,
          [channelId]: msgs.map((m) => {
            if (m.id !== messageId) return m;
            const existingReactions = m.reactions ?? [];
            const existing = existingReactions.find(r => r.emoji === reaction.emoji);
            if (existing) {
              return {
                ...m,
                reactions: existingReactions.map(r => r.emoji === reaction.emoji ? { ...r, count: reaction.count, selfReacted: r.selfReacted || reaction.selfReacted } : r)
              };
            }
            return {
              ...m,
              reactions: [...existingReactions, reaction].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
            };
          }),
        },
      };
    });
  },

  removeReaction: (messageId, channelId, emoji, userId) => {
    const { user } = useAuthStore.getState();
    const isSelf = user?.id === userId;

    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return {
        messages: {
          ...s.messages,
          [channelId]: msgs.map((m) => {
            if (m.id !== messageId) return m;
            const existingReactions = m.reactions ?? [];
            return {
              ...m,
              reactions: existingReactions.map(r => {
                if (r.emoji === emoji) {
                  return { ...r, count: Math.max(0, r.count - 1), selfReacted: isSelf ? false : r.selfReacted };
                }
                return r;
              }).filter(r => r.count > 0)
            };
          }),
        },
      };
    });
  },

  toggleReaction: async (messageId, channelId, emoji) => {
    const msgs = get().messages[channelId];
    if (!msgs) return;
    const msg = msgs.find(m => m.id === messageId);
    if (!msg) return;

    const existing = (msg.reactions ?? []).find(r => r.emoji === emoji);
    const hasReacted = existing?.selfReacted;

    try {
      if (hasReacted) {
        // Optimistic update
        get().removeReaction(messageId, channelId, emoji, useAuthStore.getState().user!.id);
        await api.delete(`/messages/${messageId}/reactions/${emoji}`);
      } else {
        // Optimistic update
        get().addReaction(messageId, channelId, { emoji, count: (existing?.count ?? 0) + 1, selfReacted: true });
        await api.put(`/messages/${messageId}/reactions/${emoji}`);
      }
    } catch (e) {
      // Revert optimism implicitly ignored for simplicity, typically would refresh or undo
      console.error("Failed to toggle reaction", e);
    }
  },

  setTyping: (channelId, user) => {
    set((s) => {
      const now = Date.now();
      const prev = (s.typingUsers[channelId] ?? []).filter(
        (u) => u.userId !== user.userId && now - u.at < 5000
      );
      return {
        typingUsers: { ...s.typingUsers, [channelId]: [...prev, user] },
      };
    });
    setTimeout(() => {
      set((s) => ({
        typingUsers: {
          ...s.typingUsers,
          [channelId]: (s.typingUsers[channelId] ?? []).filter(
            (u) => u.userId !== user.userId
          ),
        },
      }));
    }, 5000);
  },

  clearTyping: (channelId, userId) => {
    set((s) => ({
      typingUsers: {
        ...s.typingUsers,
        [channelId]: (s.typingUsers[channelId] ?? []).filter(
          (u) => u.userId !== userId
        ),
      },
    }));
  },

  markRead: (channelId) => {
    set((s) => {
      if (!s.unreadChannels[channelId] && !s.unreadCounts[channelId] && !s.mentionCounts[channelId]) return s;
      const unread = { ...s.unreadChannels };
      const unreadCounts = { ...s.unreadCounts };
      const mentions = { ...s.mentionCounts };
      delete unread[channelId];
      delete unreadCounts[channelId];
      delete mentions[channelId];
      return { unreadChannels: unread, unreadCounts, mentionCounts: mentions };
    });
  },

  clearChannel: (channelId) => {
    set((s) => {
      const msgs = { ...s.messages };
      delete msgs[channelId];
      return { messages: msgs };
    });
  },
}));
