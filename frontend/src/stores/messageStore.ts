import { create } from "zustand";
import { api } from "../lib/api";
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

  fetchMessages: (channelId: string, beforeId?: string) => Promise<void>;
  prependMessages: (channelId: string, msgs: Message[], hasMore: boolean) => void;
  addMessage: (msg: Message, activeChannelId: string | null) => void;
  updateMessage: (msg: Message) => void;
  removeMessage: (messageId: string, channelId: string) => void;
  sendMessage: (channelId: string, content: string) => Promise<void>;
  editMessage: (messageId: string, channelId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string, channelId: string) => Promise<void>;
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

  addMessage: (msg, activeChannelId) => {
    set((s) => {
      const existing = s.messages[msg.channelId] ?? [];
      if (existing.some((m) => m.id === msg.id)) return s;

      // Mark unread if the message is in a channel the user isn't looking at
      const unread = msg.channelId !== activeChannelId
        ? { ...s.unreadChannels, [msg.channelId]: true }
        : s.unreadChannels;

      // Clear typing for the message author
      const typing = (s.typingUsers[msg.channelId] ?? []).filter(
        (u) => u.userId !== msg.author?.id
      );

      return {
        messages: { ...s.messages, [msg.channelId]: [...existing, msg] },
        unreadChannels: unread,
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

  editMessage: async (messageId, _channelId, content) => {
    await api.patch(`/messages/${messageId}`, { content });
  },

  deleteMessage: async (messageId, channelId) => {
    await api.delete(`/messages/${messageId}`);
    get().removeMessage(messageId, channelId);
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
      if (!s.unreadChannels[channelId]) return s;
      const updated = { ...s.unreadChannels };
      delete updated[channelId];
      return { unreadChannels: updated };
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
