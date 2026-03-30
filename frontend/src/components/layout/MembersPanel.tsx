import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useGuildStore } from "../../stores/guildStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { PresenceDot } from "../ui/PresenceDot";

interface Member {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: string;
  status: string;
}

function MemberAvatar({ username }: { username: string }) {
  const color = `hsl(${(username.charCodeAt(0) * 37) % 360}, 55%, 45%)`;
  return (
    <div
      className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-semibold"
      style={{ backgroundColor: color }}
    >
      {username[0]?.toUpperCase()}
    </div>
  );
}

function MemberRow({ member }: { member: Member }) {
  // Use live presence from store, fall back to API value
  const liveStatus = usePresenceStore((s) => s.statuses[member.id] ?? member.status);
  const isOnline = liveStatus === "online";

  return (
    <div
      className="flex items-center gap-2 mx-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors"
      style={{ opacity: isOnline ? 1 : 0.5 }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      <div className="relative flex-shrink-0">
        <MemberAvatar username={member.username} />
        <PresenceDot status={liveStatus} borderColor="var(--color-dc-bg-secondary)" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--color-dc-header-primary)" }}>
          {member.displayName ?? member.username}
        </p>
        {member.role === "owner" && (
          <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>Owner</p>
        )}
      </div>
    </div>
  );
}

export function MembersPanel() {
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const [members, setMembers] = useState<Member[]>([]);
  const statuses = usePresenceStore((s) => s.statuses);

  useEffect(() => {
    if (!activeGuildId) return;
    api.get(`/guilds/${activeGuildId}/members`)
      .then(({ data }) => setMembers(data.data ?? []))
      .catch(() => {});
  }, [activeGuildId]);

  if (!activeGuildId) return null;

  // Re-derive online/offline on every status change
  const online = members.filter((m) => (statuses[m.id] ?? m.status) === "online");
  const offline = members.filter((m) => (statuses[m.id] ?? m.status) !== "online");

  return (
    <div
      className="w-60 flex-shrink-0 overflow-y-auto py-4"
      style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
    >
      {online.length > 0 && (
        <div className="mb-2">
          <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--color-dc-text-muted)" }}>
            Online — {online.length}
          </p>
          {online.map((m) => <MemberRow key={m.id} member={m} />)}
        </div>
      )}
      {offline.length > 0 && (
        <div>
          <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--color-dc-text-muted)" }}>
            Offline — {offline.length}
          </p>
          {offline.map((m) => <MemberRow key={m.id} member={m} />)}
        </div>
      )}
    </div>
  );
}
