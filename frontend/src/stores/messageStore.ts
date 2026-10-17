import { create } from "zustand";
import { api } from "../lib/api";
import { useAuthStore } from "./authStore";
import { useUserStore } from "./userStore";
import type { Decoration, Message } from "../types";

// Per message+emoji generation counter. Every change (optimistic or a gateway
// event) bumps it, so a failed request only rolls back if nothing newer landed.
const reactionGenerations = new Map<string, number>();

function reactionKey(messageId: string, emoji: string): string {
  return `${messageId}\u0000${emoji}`;
}

function bumpReactionGeneration(messageId: string, emoji: string): number {
  const key = reactionKey(messageId, emoji);
  const next = (reactionGenerations.get(key) ?? 0) + 1;
  reactionGenerations.set(key, next);
  return next;
}

function reactionGeneration(messageId: string, emoji: string): number {
  return reactionGenerations.get(reactionKey(messageId, emoji)) ?? 0;
}

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
  setReactionCount: (messageId: string, channelId: string, emoji: string, count: number, selfReacted: boolean) => void;
  applyReactionEvent: (messageId: string, channelId: string, emoji: string, count: number, actorId: string | undefined, action: "add" | "remove") => void;
  toggleReaction: (messageId: string, channelId: string, emoji: string) => Promise<void>;
  setTyping: (channelId: string, user: TypingUser) => void;
  clearTyping: (channelId: string, userId: string) => void;
  markRead: (channelId: string) => void;
  clearChannel: (channelId: string) => void;
  applyDecoration: (channelId: string, decoration: Decoration) => void;
  removeDecoration: (channelId: string, messageId: string, decorationId: string) => void;
  placeDecoration: (messageId: string, placement: Omit<Decoration, "id" | "messageId" | "authorId" | "createdAt">) => Promise<void>;
  deleteDecoration: (decorationId: string) => Promise<void>;
}

function withMessage(
  messages: Record<string, Message[]>,
  channelId: string,
  messageId: string,
  update: (m: Message) => Message,
): Record<string, Message[]> | null {
  const msgs = messages[channelId];
  if (!msgs?.some((m) => m.id === messageId)) return null;
  return { ...messages, [channelId]: msgs.map((m) => (m.id === messageId ? update(m) : m)) };
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
    const page = data.data as { items: Message[] | null; hasMore: boolean };
    const items = page.items ?? [];
    useUserStore.getState().upsertMany(items.map((m) => m.author));

    if (beforeId) {
      set((s) => ({
        messages: {
          ...s.messages,
          [channelId]: [...items, ...(s.messages[channelId] ?? [])],
        },
        hasMore: { ...s.hasMore, [channelId]: page.hasMore },
      }));
    } else {
      set((s) => ({
        messages: { ...s.messages, [channelId]: items },
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
    if (msg.author) useUserStore.getState().upsertUser(msg.author);
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
    if (msg.author) useUserStore.getState().upsertUser(msg.author);
    set((s) => {
      const msgs = s.messages[msg.channelId];
      if (!msgs) return s;
      return {
        messages: {
          ...s.messages,
          // Edits don't carry decorations; keep the ones already loaded.
          [msg.channelId]: msgs.map((m) => (m.id === msg.id ? { ...msg, decorations: msg.decorations ?? m.decorations } : m)),
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

  // Sets the chip to the server-provided count. A non-positive count removes it.
  applyDecoration: (channelId, decoration) => {
    set((s) => {
      const messages = withMessage(s.messages, channelId, decoration.messageId, (m) => ({
        ...m,
        decorations: [...(m.decorations ?? []).filter((d) => d.id !== decoration.id), decoration],
      }));
      return messages ? { messages } : s;
    });
  },

  removeDecoration: (channelId, messageId, decorationId) => {
    set((s) => {
      const messages = withMessage(s.messages, channelId, messageId, (m) => ({
        ...m,
        decorations: (m.decorations ?? []).filter((d) => d.id !== decorationId),
      }));
      return messages ? { messages } : s;
    });
  },

  // The gateway event applies the result for everyone, including us.
  placeDecoration: async (messageId, placement) => {
    await api.post(`/messages/${messageId}/decorations`, placement);
  },

  deleteDecoration: async (decorationId) => {
    await api.delete(`/decorations/${decorationId}`);
  },

  setReactionCount: (messageId, channelId, emoji, count, selfReacted) => {
    set((s) => {
      const msgs = s.messages[channelId];
      if (!msgs) return s;
      return {
        messages: {
          ...s.messages,
          [channelId]: msgs.map((m) => {
            if (m.id !== messageId) return m;
            const others = (m.reactions ?? []).filter((r) => r.emoji !== emoji);
            if (count <= 0) return { ...m, reactions: others };
            return {
              ...m,
              reactions: [...others, { emoji, count, selfReacted }].sort(
                (a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji)
              ),
            };
          }),
        },
      };
    });
  },

  // Applies a gateway reaction event. Counts come straight from the server;
  // selfReacted only changes for the current user's own actions.
  applyReactionEvent: (messageId, channelId, emoji, count, actorId, action) => {
    // A server event supersedes any in-flight optimistic update, so a later
    // failed request must not roll this back.
    bumpReactionGeneration(messageId, emoji);
    const me = useAuthStore.getState().user;
    const msg = get().messages[channelId]?.find((m) => m.id === messageId);
    const existing = (msg?.reactions ?? []).find((r) => r.emoji === emoji);
    let selfReacted = existing?.selfReacted ?? false;
    if (actorId && me?.id === actorId) {
      selfReacted = action === "add";
    }
    get().setReactionCount(messageId, channelId, emoji, count, selfReacted);
  },

  toggleReaction: async (messageId, channelId, emoji) => {
    const msgs = get().messages[channelId];
    if (!msgs) return;
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg) return;
    const me = useAuthStore.getState().user;
    if (!me) return;

    const existing = (msg.reactions ?? []).find((r) => r.emoji === emoji);
    const prevCount = existing?.count ?? 0;
    const prevSelf = existing?.selfReacted ?? false;
    const wasReacted = prevSelf;

    const generation = bumpReactionGeneration(messageId, emoji);

    // Optimistic change, reverted if the request fails and nothing newer arrived.
    if (wasReacted) {
      get().setReactionCount(messageId, channelId, emoji, Math.max(0, prevCount - 1), false);
    } else {
      get().setReactionCount(messageId, channelId, emoji, prevCount + 1, true);
    }

    try {
      const url = `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`;
      if (wasReacted) await api.delete(url);
      else await api.put(url);
    } catch {
      // Our action did not persist, so restore our own flag. Keep the newest
      // server count if another event landed while the request was in flight.
      const current = get().messages[channelId]?.find((m) => m.id === messageId)
        ?.reactions?.find((r) => r.emoji === emoji);
      const count = reactionGeneration(messageId, emoji) === generation
        ? prevCount
        : current?.count ?? prevCount;
      get().setReactionCount(messageId, channelId, emoji, count, wasReacted);
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
