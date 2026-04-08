import { useEffect, useRef } from "react";
import type { Member, GuildRole } from "../../types";
import { usePresenceStore } from "../../stores/presenceStore";

interface Props {
  member: Member;
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
}

function Avatar({ username, size = 56 }: { username: string; size?: number }) {
  const color = `hsl(${(username.charCodeAt(0) * 37) % 360}, 55%, 45%)`;
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.38 }}
    >
      {username[0]?.toUpperCase()}
    </div>
  );
}

function StatusLabel({ status }: { status: string }) {
  const isOnline = status === "online";
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{
        backgroundColor: isOnline ? "rgba(35,165,90,0.2)" : "rgba(116,127,141,0.2)",
        color: isOnline ? "#23a55a" : "#747f8d",
      }}
    >
      {isOnline ? "Online" : "Offline"}
    </span>
  );
}

export function MemberProfilePopup({ member, anchorRef, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const liveStatus = usePresenceStore((s) => s.statuses[member.id] ?? member.status);
  const safeRoles: GuildRole[] = member.roles ?? [];

  // Position to the left of the anchor (member list is on the right)
  const pos = (() => {
    if (!anchorRef.current) return { top: 0, left: 0 };
    const rect = anchorRef.current.getBoundingClientRect();
    const W = 260;
    const H = 320;
    let left = rect.left - W - 8;
    if (left < 8) left = rect.right + 8; // flip to right if no room
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    let top = rect.top;
    if (top + H > window.innerHeight - 8) top = window.innerHeight - H - 8;
    if (top < 8) top = 8;
    return { top, left };
  })();

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  // Close on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className="fixed z-[9999] w-64 rounded-xl shadow-2xl overflow-hidden"
      style={{
        top: pos.top,
        left: pos.left,
        backgroundColor: "var(--color-dc-bg-floating)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Color banner */}
      <div
        className="h-16 w-full"
        style={{
          backgroundColor: safeRoles[0]?.color ?? "var(--color-dc-brand)",
          opacity: 0.85,
        }}
      />

      {/* Avatar overlapping banner */}
      <div className="px-4 pb-3">
        <div className="flex items-end justify-between -mt-7 mb-3">
          <div
            className="rounded-full p-1"
            style={{ backgroundColor: "var(--color-dc-bg-floating)" }}
          >
            <Avatar username={member.username} size={52} />
          </div>
          <StatusLabel status={liveStatus} />
        </div>

        {/* Name */}
        <p className="font-bold text-base" style={{ color: "var(--color-dc-header-primary)" }}>
          {member.displayName ?? member.username}
        </p>
        {member.displayName && (
          <p className="text-xs mb-3" style={{ color: "var(--color-dc-text-muted)" }}>
            {member.username}
          </p>
        )}

        {/* Permission tier badge */}
        {member.role !== "member" && (
          <div className="mb-3">
            <span
              className="text-[10px] px-2 py-0.5 rounded font-semibold uppercase"
              style={{
                backgroundColor: member.role === "owner"
                  ? "rgba(240,177,50,0.2)"
                  : member.role === "admin"
                  ? "rgba(218,55,60,0.2)"
                  : "rgba(88,101,242,0.2)",
                color: member.role === "owner"
                  ? "#f0b132"
                  : member.role === "admin"
                  ? "#da373c"
                  : "#5865f2",
              }}
            >
              {member.role}
            </span>
          </div>
        )}

        {/* Divider */}
        <div className="h-px mb-3" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />

        {/* Roles */}
        {safeRoles.length > 0 ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
              Roles — {safeRoles.length}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {safeRoles.map((role) => (
                <span
                  key={role.id}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    backgroundColor: `${role.color}22`,
                    color: role.color,
                    border: `1px solid ${role.color}44`,
                  }}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
                  {role.name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>No roles</p>
        )}
      </div>
    </div>
  );
}
