import { useEffect } from "react";
import { useAuthStore } from "../stores/authStore";
import { useGuildStore } from "../stores/guildStore";
import { useFriendStore } from "../stores/friendStore";
import { useMessageStore } from "../stores/messageStore";

export interface ServerReadState {
  channelId: string;
  guildId?: string;
  unread: boolean;
  mentionCount: number;
}

const readTimes = new Map<string, number>();

export function seedReadStates(states: ServerReadState[]) {
  readTimes.clear();
  const unreadChannels: Record<string, boolean> = {};
  const unreadCounts: Record<string, number> = {};
  const mentionCounts: Record<string, number> = {};
  const channelGuilds: Record<string, string> = {};
  for (const state of states) {
    unreadChannels[state.channelId] = state.unread;
    mentionCounts[state.channelId] = state.mentionCount;
    if (state.guildId) channelGuilds[state.channelId] = state.guildId;
    else unreadCounts[state.channelId] = state.unread ? state.mentionCount : 0;
  }
  useMessageStore.setState({ unreadChannels, unreadCounts, mentionCounts, channelGuilds });
}

export function applyReadState(channelId: string, lastReadAt: string) {
  const at = Date.parse(lastReadAt);
  if (!Number.isFinite(at) || at < (readTimes.get(channelId) ?? 0)) return;
  readTimes.set(channelId, at);
  const userId = useAuthStore.getState().user?.id;
  useMessageStore.setState((s) => {
    // An ack can arrive after a newer message. Do not erase that message's unread state.
    const newer = (s.messages[channelId] ?? []).filter((m) =>
      m.author.id !== userId && Date.parse(m.createdAt) > at);
    const mentions = newer.filter((m) => !m.guildId || (userId && m.mentions?.includes(userId))).length;
    return {
      unreadChannels: { ...s.unreadChannels, [channelId]: !!s.unreadChannels[channelId] && newer.length > 0 },
      unreadCounts: { ...s.unreadCounts, [channelId]: Math.min(s.unreadCounts[channelId] ?? 0, newer.length) },
      mentionCounts: { ...s.mentionCounts, [channelId]: Math.min(s.mentionCounts[channelId] ?? 0, mentions) },
    };
  });
}

export function useReadState() {
  const guildId = useGuildStore((s) => s.activeGuildId);
  const channelId = useGuildStore((s) => s.activeChannelId);
  const channels = useGuildStore((s) => s.channels);
  const dmId = useFriendStore((s) => s.activeDMId);
  const unread = useMessageStore((s) => s.unreadChannels);
  useEffect(() => {
    const read = () => {
      if (!document.hasFocus() || document.visibilityState === "hidden") return;
      const id = guildId ? channelId : dmId;
      if (!id) return;
      if (guildId) {
        const channel = channels[guildId]?.find((c) => c.id === id);
        if (channel?.type !== "text") return;
      }
      useMessageStore.getState().markRead(id);
    };
    read();
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, [guildId, channelId, dmId, unread, channels]);
}
