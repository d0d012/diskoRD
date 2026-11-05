import { useMessageStore } from "../stores/messageStore";
import { useFriendStore } from "../stores/friendStore";
import { useNotificationStore } from "../stores/notificationStore";
import { selectUnreadBadge } from "../lib/unreadBadge";

export function useUnreadBadge() {
  const unreadCounts = useMessageStore((s) => s.unreadCounts);
  const mentionCounts = useMessageStore((s) => s.mentionCounts);
  const channelGuilds = useMessageStore((s) => s.channelGuilds);
  const dms = useFriendStore((s) => s.dms);
  const activeDMId = useFriendStore((s) => s.activeDMId);
  const mutedChannels = useNotificationStore((s) => s.mutedChannels);
  const mutedDmUsers = useNotificationStore((s) => s.mutedDmUsers);
  return selectUnreadBadge({ unreadCounts, mentionCounts, channelGuilds, dms, activeDMId, mutedChannels, mutedDmUsers });
}
