import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useFriendStore } from "../../stores/friendStore";
import { useUserStore } from "../../stores/userStore";
import type { PublicUser } from "../../types";

// Reuse and cache the existing guild roster endpoint; never suggest global search results.
const rosterCache = new Map<string, PublicUser[]>();

export function clearMentionRosterCache(): void {
  rosterCache.clear();
}

export function useMentionCandidates(guildId: string, channelId: string, _active: boolean): PublicUser[] {
  const [roster, setRoster] = useState<{ guildId: string; users: PublicUser[] } | null>(() => guildId && rosterCache.has(guildId) ? { guildId, users: rosterCache.get(guildId)! } : null);
  const self = useAuthStore((s) => s.user);
  const recipient = useFriendStore((s) => s.dms.find((dm) => dm.id === channelId)?.recipient);
  const liveUsers = useUserStore((s) => s.users);

  useEffect(() => {
    if (!guildId) return;
    let cancelled = false;
    function load() {
      api.get(`/guilds/${guildId}/members`)
        .then(({ data }) => {
          const users = data.data ?? [];
          rosterCache.set(guildId, users);
          if (!cancelled) setRoster({ guildId, users });
        })
        .catch(() => {
          if (!cancelled && !rosterCache.has(guildId)) setRoster({ guildId, users: [] });
        });
    }
    function membersChanged(event: Event) {
      if ((event as CustomEvent<{ guildId: string }>).detail?.guildId === guildId) load();
    }
    if (!rosterCache.has(guildId)) load();
    window.addEventListener("diskord:guild-members-changed", membersChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("diskord:guild-members-changed", membersChanged);
    };
  }, [guildId]);

  const users = guildId
    ? (roster?.guildId === guildId ? roster.users : [])
    : [self, recipient].filter((user): user is NonNullable<typeof user> => !!user);
  return users
    .filter((user, index) => users.findIndex((other) => other.id === user.id) === index)
    .map((user) => ({ ...user, ...liveUsers[user.id] }));
}
