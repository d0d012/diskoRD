import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useGuildStore } from "../../stores/guildStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useAuthStore } from "../../stores/authStore";
import { PresenceDot } from "../ui/PresenceDot";
import { RolePicker } from "../../features/guild/RolePicker";
import { MemberProfilePopup } from "../../features/guild/MemberProfilePopup";
import type { GuildRole, Member } from "../../types";

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

// Returns the highest-position role that has a non-default color
function displayColor(roles: GuildRole[] | undefined): string | null {
  if (!roles?.length) return null;
  const sorted = [...roles].sort((a, b) => b.position - a.position);
  const colored = sorted.find((r) => r.color && r.color !== "#99aab5");
  return colored?.color ?? null;
}

function RoleBadge({ role }: { role: GuildRole }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase leading-none"
      style={{ backgroundColor: `${role.color}22`, color: role.color, border: `1px solid ${role.color}44` }}
    >
      {role.name}
    </span>
  );
}

function MemberRow({ member, guildId }: { member: Member; guildId: string }) {
  const liveStatus = usePresenceStore((s) => s.statuses[member.id] ?? member.status);
  const isOnline = liveStatus === "online";
  const currentUser = useAuthStore((s) => s.user);
  const rolesMap = useGuildStore((s) => s.roles);
  const roles = rolesMap[guildId] ?? [];
  const { fetchRoles } = useGuildStore();

  const [showPicker, setShowPicker] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const safeRoles = member.roles ?? [];
  const nameColor = displayColor(safeRoles);
  const topRole = safeRoles[0] ?? null;

  function handleAddClick(e: React.MouseEvent) {
    e.stopPropagation(); // don't open profile popup
    if (roles.length === 0) fetchRoles(guildId);
    setShowPicker(true);
    setShowProfile(false);
  }

  return (
    <div className="group relative">
      <div
        ref={rowRef}
        className="flex items-center gap-2 mx-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors"
        style={{ opacity: isOnline ? 1 : 0.5 }}
        onClick={() => setShowProfile(true)}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
      >
        <div className="relative flex-shrink-0">
          <MemberAvatar username={member.username} />
          <PresenceDot status={liveStatus} borderColor="var(--color-dc-bg-secondary)" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-medium truncate"
            style={{ color: nameColor ?? "var(--color-dc-header-primary)" }}
          >
            {member.displayName ?? member.username}
          </p>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {member.role === "owner" && (
              <span className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>Owner</span>
            )}
            {topRole && <RoleBadge role={topRole} />}
          </div>
        </div>

        {/* + button — only for others, visible on hover */}
        {currentUser?.id !== member.id && (
          <button
            ref={addBtnRef}
            onClick={handleAddClick}
            className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center transition-all flex-shrink-0"
            style={{ color: "var(--color-dc-interactive-normal)" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-floating)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            title="Manage roles"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
          </button>
        )}
      </div>

      {showPicker && (
        <RolePicker
          guildId={guildId}
          userId={member.id}
          assignedRoleIds={(member.roles ?? []).map((r) => r.id)}
          anchorRef={addBtnRef as React.RefObject<HTMLElement>}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showProfile && (
        <MemberProfilePopup
          member={member}
          anchorRef={rowRef as React.RefObject<HTMLElement>}
          onClose={() => setShowProfile(false)}
        />
      )}
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <p className="px-3 mb-1 mt-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-dc-text-muted)" }}>
      {label} — {count}
    </p>
  );
}

export function MembersPanel() {
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const rolesMap = useGuildStore((s) => s.roles);
  const roles = (activeGuildId ? rolesMap[activeGuildId] : undefined) ?? [];
  const { fetchRoles } = useGuildStore();
  const [members, setMembers] = useState<Member[]>([]);
  const statuses = usePresenceStore((s) => s.statuses);

  useEffect(() => {
    if (!activeGuildId) return;
    api.get(`/guilds/${activeGuildId}/members`)
      .then(({ data }) => setMembers(data.data ?? []))
      .catch(() => {});
    fetchRoles(activeGuildId);
  }, [activeGuildId]);

  if (!activeGuildId) return null;

  const withStatus = members.map((m) => ({
    ...m,
    liveStatus: statuses[m.id] ?? m.status,
  }));

  const online = withStatus.filter((m) => m.liveStatus === "online");
  const offline = withStatus.filter((m) => m.liveStatus !== "online");

  // Build hoisted sections from roles sorted by position desc
  const hoistedRoles = [...roles].filter((r) => r.hoist).sort((a, b) => b.position - a.position);

  // Track which member IDs have been placed
  const placed = new Set<string>();

  const sections: { label: string; color?: string; members: Member[] }[] = [];

  for (const hoistRole of hoistedRoles) {
    const inRole = online.filter(
      (m) => (m.roles ?? []).some((r) => r.id === hoistRole.id) && !placed.has(m.id)
    );
    if (inRole.length > 0) {
      inRole.forEach((m) => placed.add(m.id));
      sections.push({ label: hoistRole.name, color: hoistRole.color, members: inRole });
    }
  }

  const remainingOnline = online.filter((m) => !placed.has(m.id));

  return (
    <div
      className="w-60 flex-shrink-0 overflow-y-auto py-4"
      style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
    >
      {/* Hoisted role sections */}
      {sections.map((sec) => (
        <div key={sec.label} className="mb-2">
          <p
            className="px-3 mb-1 mt-2 text-xs font-semibold uppercase tracking-wide"
            style={{ color: sec.color ?? "var(--color-dc-text-muted)" }}
          >
            {sec.label} — {sec.members.length}
          </p>
          {sec.members.map((m) => (
            <MemberRow key={m.id} member={m} guildId={activeGuildId} />
          ))}
        </div>
      ))}

      {/* Remaining online */}
      {remainingOnline.length > 0 && (
        <div className="mb-2">
          <SectionHeader label="Online" count={remainingOnline.length} />
          {remainingOnline.map((m) => (
            <MemberRow key={m.id} member={m} guildId={activeGuildId} />
          ))}
        </div>
      )}

      {/* Offline */}
      {offline.length > 0 && (
        <div>
          <SectionHeader label="Offline" count={offline.length} />
          {offline.map((m) => (
            <MemberRow key={m.id} member={m} guildId={activeGuildId} />
          ))}
        </div>
      )}
    </div>
  );
}
