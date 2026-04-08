import { useEffect, useRef, useState } from "react";
import { useGuildStore } from "../../stores/guildStore";
import type { GuildRole } from "../../types";

interface Props {
  guildId: string;
  userId: string;
  assignedRoleIds: string[];
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
}

export function RolePicker({ guildId, userId, assignedRoleIds, anchorRef, onClose }: Props) {
  const rolesMap = useGuildStore((s) => s.roles);
  const roles = rolesMap[guildId] ?? [];
  const { assignRole, removeRole } = useGuildStore();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [localAssigned, setLocalAssigned] = useState<Set<string>>(new Set(assignedRoleIds));
  const containerRef = useRef<HTMLDivElement>(null);

  // Position near the anchor, clamped to viewport
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const W = 224; // w-56
    const H = 320; // approx max height
    let top = rect.bottom + 4;
    let left = rect.left;
    // Clamp right edge
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    if (left < 8) left = 8;
    // Flip above if not enough room below
    if (top + H > window.innerHeight - 8) top = rect.top - H - 4;
    if (top < 8) top = 8;
    setPos({ top, left });
  }, [anchorRef]);

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

  const filtered = roles.filter((r) =>
    r.name.toLowerCase().includes(query.toLowerCase())
  );

  async function toggle(role: GuildRole) {
    if (loading) return;
    setLoading(role.id);
    const isAssigned = localAssigned.has(role.id);
    // Optimistic
    setLocalAssigned((prev) => {
      const next = new Set(prev);
      if (isAssigned) { next.delete(role.id); } else { next.add(role.id); }
      return next;
    });
    try {
      if (isAssigned) {
        await removeRole(guildId, userId, role.id);
      } else {
        await assignRole(guildId, userId, role.id);
      }
    } catch {
      // Revert
      setLocalAssigned((prev) => {
        const next = new Set(prev);
        if (isAssigned) { next.add(role.id); } else { next.delete(role.id); }
        return next;
      });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      ref={containerRef}
      className="fixed z-[9999] w-56 rounded-lg shadow-xl overflow-hidden"
      style={{
        top: pos.top,
        left: pos.left,
        backgroundColor: "var(--color-dc-bg-floating)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Search */}
      <div className="p-2 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search roles..."
          className="w-full bg-transparent text-sm outline-none px-2 py-1 rounded"
          style={{ color: "var(--color-dc-text-normal)", backgroundColor: "var(--color-dc-bg-secondary)" }}
        />
      </div>

      {/* Role list */}
      <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
        {filtered.length === 0 && (
          <p className="text-xs px-3 py-4 text-center" style={{ color: "var(--color-dc-text-muted)" }}>
            No roles found
          </p>
        )}
        {filtered.map((role) => {
          const assigned = localAssigned.has(role.id);
          return (
            <button
              key={role.id}
              onClick={() => toggle(role)}
              disabled={loading === role.id}
              className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
              style={{ opacity: loading === role.id ? 0.6 : 1 }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              {/* Color dot */}
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: role.color }}
              />
              <span className="flex-1 text-sm truncate" style={{ color: "var(--color-dc-text-normal)" }}>
                {role.name}
              </span>
              {/* Checkmark */}
              {assigned && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-brand)", flexShrink: 0 }}>
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
