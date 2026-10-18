import { useEffect, useState } from "react";
import { useFriendStore } from "../../stores/friendStore";
import { useAuthStore } from "../../stores/authStore";
import { useMessageStore } from "../../stores/messageStore";
import { useUserStore } from "../../stores/userStore";
import { Avatar } from "../../components/ui/Avatar";
import { statusColor, statusLabel } from "../../lib/avatar";
import { useNotificationStore } from "../../stores/notificationStore";
import { VoiceStatusBar } from "../voice/VoiceStatusBar";
import { UserSettingsModal } from "../settings/UserSettingsModal";
import { useShowcaseOverlayStore } from "../../stores/showcaseOverlayStore";

export function FriendsSidebar() {
  const { dms, activeDMId, setActiveDM, fetchDMs, requests } = useFriendStore();
  const { user } = useAuthStore();
  const status = useNotificationStore((s) => s.status);
  const [showSettings, setShowSettings] = useState(false);
  const unreadCounts = useMessageStore((s) => s.unreadCounts);
  const markRead = useMessageStore((s) => s.markRead);
  const pendingCount = requests.filter((r) => r.direction === "incoming").length;
  const [query, setQuery] = useState("");
  const q = query.trim().toLocaleLowerCase();
  const visibleDMs = q ? dms.filter((dm) => dm.recipient.username.toLocaleLowerCase().includes(q)) : dms;
  const liveUsers = useUserStore((s) => s.users);

  useEffect(() => {
    fetchDMs();
  }, []);

  return (
    <div className="w-60 flex-shrink-0 flex flex-col" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
      {/* Search */}
      <div className="h-12 px-2.5 flex items-center flex-shrink-0 border-b" style={{ borderColor: "var(--color-dc-bg-floating)" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            if (e.key === "Enter" && visibleDMs[0]) {
              setActiveDM(visibleDMs[0].id);
              markRead(visibleDMs[0].id);
              setQuery("");
            }
          }}
          placeholder="Find a conversation"
          aria-label="Find a conversation"
          className="w-full h-7 px-2 rounded text-sm outline-none placeholder:text-[var(--color-dc-text-muted)]"
          style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-normal)" }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {/* Friends button */}
        <button
          onClick={() => setActiveDM(null)}
          className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm transition-colors relative"
          style={{
            backgroundColor: activeDMId === null ? "var(--color-dc-bg-modifier-selected)" : "transparent",
            color: activeDMId === null ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-normal)",
          }}
          onMouseEnter={(e) => {
            if (activeDMId !== null) e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)";
          }}
          onMouseLeave={(e) => {
            if (activeDMId !== null) e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
          </svg>
          <span className="flex-1 text-left font-medium">Friends</span>
          {pendingCount > 0 && (
            <span className="w-4 h-4 rounded-full flex items-center justify-center text-white text-xs"
              style={{ backgroundColor: "var(--color-dc-red)", fontSize: "10px" }}>
              {pendingCount}
            </span>
          )}
        </button>

        {/* DMs section */}
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide px-2 mb-1"
            style={{ color: "var(--color-dc-text-muted)" }}>
            Direct Messages
          </p>
          {visibleDMs.map((dm) => {
            const live = { ...dm.recipient, ...liveUsers[dm.recipient.id] };
            const active = activeDMId === dm.id;
            const unread = !active ? unreadCounts[dm.id] ?? 0 : 0;
            const offline = dm.recipient.status === "offline" || !dm.recipient.status;
            return (
              <button
                key={dm.id}
                onClick={() => {
                  setActiveDM(dm.id);
                  markRead(dm.id);
                }}
                className={`group w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-sm transition-colors ${
                  active ? "" : "hover:bg-[var(--color-dc-bg-modifier-hover)]"
                }`}
                style={{
                  backgroundColor: active ? "var(--color-dc-bg-modifier-selected)" : undefined,
                  color: active || unread ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-normal)",
                }}
              >
                <div className={offline && !active && !unread ? "opacity-50 group-hover:opacity-100 transition-opacity" : ""}>
                  <Avatar name={live.username} src={live.avatarUrl} size={32} status={dm.recipient.status}
                    ringColor="var(--color-dc-bg-secondary)" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className={`truncate leading-tight ${unread ? "font-semibold" : "font-medium"}`}>
                    {live.displayName || live.username}
                  </div>
                  <div className="truncate text-xs leading-tight" style={{ color: "var(--color-dc-text-muted)" }}>
                    {statusLabel(dm.recipient.status)}
                  </div>
                </div>
                {unread > 0 && (
                  <span
                    className="min-w-4 h-4 px-1 rounded-full flex items-center justify-center text-white"
                    style={{ backgroundColor: "var(--color-dc-red)", fontSize: "10px" }}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
            );
          })}
          {visibleDMs.length === 0 && (
            <p className="px-2 py-3 text-sm" style={{ color: "var(--color-dc-text-muted)" }}>
              {q ? `No conversations match "${query.trim()}".` : "No conversations yet. Message a friend to start one."}
            </p>
          )}
        </div>
      </div>

      {showSettings && <UserSettingsModal onClose={() => setShowSettings(false)} />}

      <VoiceStatusBar />

      {/* User panel */}
      <div className="h-[52px] flex items-center px-2 flex-shrink-0"
        style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}>
        <div className="flex items-center gap-2 flex-1 p-1 rounded-md cursor-pointer transition-colors"
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}>
          <div className="relative flex-shrink-0">
            <Avatar name={user?.username ?? "?"} src={user?.avatarUrl} size={32} status={status} ringColor="var(--color-dc-bg-tertiary)" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold leading-tight truncate" style={{ color: "var(--color-dc-header-primary)" }}>
              {user?.username ?? "…"}
            </span>
            <span className="text-xs leading-tight" style={{ color: statusColor(status) }}>{statusLabel(status)}</span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); if (user) useShowcaseOverlayStore.getState().open(user.id); }}
            className="p-1 rounded"
            title="My showcase"
            aria-label="My showcase"
            style={{ color: "var(--color-dc-interactive-normal)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M4 3h16v2H4V3zm1 4h14v10H5V7zm2 2v6h10V9H7zm-3 10h16v2H4v-2z" />
            </svg>
          </button>
          <button onClick={() => setShowSettings(true)} className="p-1 rounded" title="User Settings" aria-label="User Settings"
            style={{ color: "var(--color-dc-interactive-normal)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.477.477 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
