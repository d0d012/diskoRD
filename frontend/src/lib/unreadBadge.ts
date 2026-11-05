interface UnreadBadgeState {
  dms: readonly { id: string; recipient: { id: string } }[];
  activeDMId: string | null;
  unreadCounts: Readonly<Record<string, number>>;
  mentionCounts: Readonly<Record<string, number>>;
  channelGuilds: Readonly<Record<string, string>>;
  mutedChannels: ReadonlySet<string>;
  mutedDmUsers: ReadonlySet<string>;
}

export function selectUnreadBadge(state: UnreadBadgeState) {
  const dmUnread = state.dms.reduce((sum, dm) => sum + (
    dm.id !== state.activeDMId && !state.mutedChannels.has(dm.id) && !state.mutedDmUsers.has(dm.recipient.id)
      ? state.unreadCounts[dm.id] ?? 0 : 0
  ), 0);
  const mentions = Object.entries(state.mentionCounts).reduce((sum, [id, count]) =>
    sum + (state.channelGuilds[id] && !state.mutedChannels.has(id) ? count : 0), 0);
  return { dmUnread, osTotal: dmUnread + mentions };
}

export function formatBadge(n: number): string {
  return n <= 0 ? "" : n > 99 ? "99+" : String(n);
}
