import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useGuildStore } from "../../stores/guildStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useAuthStore } from "../../stores/authStore";
import { useUserStore } from "../../stores/userStore";
import { useLiveUser } from "../../hooks/useLiveUser";
import { Avatar } from "../ui/Avatar";
import { RolePicker } from "../../features/guild/RolePicker";
import { UserProfilePopover } from "../../features/profile/UserProfilePopover";
import type { GuildRole, Member } from "../../types";

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

function MemberRow({ member, guildId, canManageRoles }: { member: Member; guildId: string; canManageRoles: boolean }) {
  const live = useLiveUser(member.id, member);
  const liveStatus = usePresenceStore((s) => s.statuses[member.id] ?? member.status);
  const isOnline = liveStatus !== "offline";
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
        <Avatar name={live.username} src={live.avatarUrl} size={32} status={liveStatus} ringColor="var(--color-dc-bg-secondary)" />
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-medium truncate"
            style={{ color: nameColor ?? "var(--color-dc-header-primary)" }}
          >
            {live.displayName ?? live.username}
          </p>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {member.role === "owner" && (
              <span className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>Owner</span>
            )}
            {topRole && <RoleBadge role={topRole} />}
          </div>
        </div>

        {/* + button — only for others, visible on hover */}
        {canManageRoles && currentUser?.id !== member.id && (
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
        <UserProfilePopover
          userId={member.id}
          guildId={guildId}
          member={member}
          canManageRoles={canManageRoles}
          anchorRef={rowRef as React.RefObject<HTMLElement | null>}
          preferredSide="left"
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
  const currentUser = useAuthStore((s) => s.user);
  const [members, setMembers] = useState<Member[]>([]);
  const statuses = usePresenceStore((s) => s.statuses);

  useEffect(() => {
    if (!activeGuildId) return;

    function refreshMembers() {
      api.get(`/guilds/${activeGuildId}/members`)
        .then(({ data }) => {
          const list: Member[] = data.data ?? [];
          useUserStore.getState().upsertMany(list);
          setMembers(list);
        })
        .catch(() => {});
      fetchRoles(activeGuildId!);
    }

    function handleMembersChanged(event: Event) {
      const detail = (event as CustomEvent<{ guildId?: string }>).detail;
      if (!detail?.guildId || detail.guildId === activeGuildId) refreshMembers();
    }

    refreshMembers();
    window.addEventListener("diskord:guild-members-changed", handleMembersChanged);
    return () => window.removeEventListener("diskord:guild-members-changed", handleMembersChanged);
  }, [activeGuildId]);

  if (!activeGuildId) return null;

  const myRole = members.find((m) => m.id === currentUser?.id)?.role ?? "member";
  // Assigning/removing roles requires at least the moderator tier (matches the server).
  const canManageRoles = myRole !== "member";

  const withStatus = members.map((m) => ({
    ...m,
    liveStatus: statuses[m.id] ?? m.status,
  }));

  // Anything that isn't offline counts as online, so idle/dnd stay grouped.
  const online = withStatus.filter((m) => m.liveStatus !== "offline");
  const offline = withStatus.filter((m) => m.liveStatus === "offline");

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
            <MemberRow key={m.id} member={m} guildId={activeGuildId} canManageRoles={canManageRoles} />
          ))}
        </div>
      ))}

      {/* Remaining online */}
      {remainingOnline.length > 0 && (
        <div className="mb-2">
          <SectionHeader label="Online" count={remainingOnline.length} />
          {remainingOnline.map((m) => (
            <MemberRow key={m.id} member={m} guildId={activeGuildId} canManageRoles={canManageRoles} />
          ))}
        </div>
      )}

      {/* Offline */}
      {offline.length > 0 && (
        <div>
          <SectionHeader label="Offline" count={offline.length} />
          {offline.map((m) => (
            <MemberRow key={m.id} member={m} guildId={activeGuildId} canManageRoles={canManageRoles} />
          ))}
        </div>
      )}
    </div>
  );
}
