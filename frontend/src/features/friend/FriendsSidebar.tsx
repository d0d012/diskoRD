import { useEffect } from "react";
import { useFriendStore } from "../../stores/friendStore";
import { useAuthStore } from "../../stores/authStore";
import { PresenceDot } from "../../components/ui/PresenceDot";
import { VoiceStatusBar } from "../voice/VoiceStatusBar";

export function FriendsSidebar() {
  const { dms, activeDMId, setActiveDM, fetchDMs, requests } = useFriendStore();
  const { user, logout } = useAuthStore();
  const pendingCount = requests.filter((r) => r.direction === "incoming").length;

  useEffect(() => {
    fetchDMs();
  }, []);

  return (
    <div className="w-60 flex-shrink-0 flex flex-col" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
      {/* Search bar placeholder */}
      <div className="px-2 pt-2 pb-1 flex-shrink-0">
        <div
          className="flex items-center px-2 py-1.5 rounded cursor-text text-sm"
          style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-muted)" }}
        >
          Find or start a conversation
        </div>
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
        {dms.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide px-2 mb-1"
              style={{ color: "var(--color-dc-text-muted)" }}>
              Direct Messages
            </p>
            {dms.map((dm) => (
              <button
                key={dm.id}
                onClick={() => setActiveDM(dm.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors"
                style={{
                  backgroundColor: activeDMId === dm.id ? "var(--color-dc-bg-modifier-selected)" : "transparent",
                  color: activeDMId === dm.id ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-normal)",
                }}
                onMouseEnter={(e) => {
                  if (activeDMId !== dm.id) e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)";
                }}
                onMouseLeave={(e) => {
                  if (activeDMId !== dm.id) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <div className="relative flex-shrink-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{
                      backgroundColor: `hsl(${(dm.recipient.username.charCodeAt(0) * 37) % 360}, 55%, 45%)`,
                    }}
                  >
                    {dm.recipient.username[0]?.toUpperCase()}
                  </div>
                  <PresenceDot status={dm.recipient.status} size={10} borderColor="var(--color-dc-bg-secondary)" />
                </div>
                <span className="truncate font-medium">{dm.recipient.username}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <VoiceStatusBar />

      {/* User panel */}
      <div className="h-[52px] flex items-center px-2 flex-shrink-0"
        style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}>
        <div className="flex items-center gap-2 flex-1 p-1 rounded-md cursor-pointer transition-colors"
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}>
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold"
              style={{ backgroundColor: "var(--color-dc-brand)" }}>
              {user?.username?.[0]?.toUpperCase() ?? "?"}
            </div>
            <PresenceDot status="online" size={10} borderColor="var(--color-dc-bg-tertiary)" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold leading-tight truncate" style={{ color: "var(--color-dc-header-primary)" }}>
              {user?.username ?? "…"}
            </span>
            <span className="text-xs leading-tight" style={{ color: "var(--color-dc-text-muted)" }}>Online</span>
          </div>
          <button onClick={() => logout()} className="p-1 rounded" title="Log Out"
            style={{ color: "var(--color-dc-interactive-normal)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
