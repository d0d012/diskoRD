import { useGuildStore } from "../../stores/guildStore";
import { useAuthStore } from "../../stores/authStore";

function ChannelItem({
  name,
  type,
  active,
  onClick,
}: {
  name: string;
  type: "text" | "voice";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm cursor-pointer group transition-colors ${
        active
          ? "bg-[var(--color-dc-bg-modifier-selected)] text-[var(--color-dc-interactive-active)]"
          : "text-[var(--color-dc-interactive-normal)] hover:bg-[var(--color-dc-bg-modifier-hover)] hover:text-[var(--color-dc-interactive-hover)]"
      }`}
    >
      {/* Channel icon */}
      {type === "text" ? (
        <span className="text-[var(--color-dc-channel-default)] text-base leading-none group-[.active]:text-[var(--color-dc-interactive-active)]">
          #
        </span>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--color-dc-channel-default)] flex-shrink-0">
          <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12z" />
          <path d="M9 9a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V9z" />
        </svg>
      )}
      <span className="truncate">{name}</span>
    </button>
  );
}

function UserPanel() {
  const { user, logout } = useAuthStore();

  return (
    <div
      className="flex items-center gap-2 p-2 cursor-pointer rounded-md hover:bg-[var(--color-dc-bg-modifier-hover)] transition-colors"
      title={user?.displayName ?? user?.username ?? ""}
    >
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-[var(--color-dc-brand)] flex items-center justify-center text-white text-sm font-semibold">
          {user?.username?.[0]?.toUpperCase() ?? "?"}
        </div>
        {/* Status dot */}
        <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[var(--color-dc-online)] border-2 border-[var(--color-dc-bg-secondary)]" />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-[var(--color-dc-header-primary)] text-sm font-semibold leading-tight truncate">
          {user?.username ?? "..."}
        </span>
        <span className="text-[var(--color-dc-text-muted)] text-xs leading-tight">
          {user?.displayName ?? user?.username ?? ""}
        </span>
      </div>
      <div className="ml-auto flex gap-1">
        {/* Mute button */}
        <button
          className="p-1 rounded hover:bg-[var(--color-dc-bg-modifier-hover)] text-[var(--color-dc-interactive-normal)] hover:text-[var(--color-dc-interactive-hover)]"
          title="Mute"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14.99 11c0 1.38-1.12 2.5-2.5 2.5-.36 0-.69-.08-1-.21v-4.58c.31-.13.64-.21 1-.21 1.38 0 2.5 1.12 2.5 2.5z" />
            <path d="M12 3a9 9 0 0 1 9 9 9 9 0 0 1-9 9 9 9 0 0 1-9-9 9 9 0 0 1 9-9m0-2C5.37 1 1 5.37 1 12s4.37 11 11 11 11-4.37 11-11S18.63 1 12 1z" />
          </svg>
        </button>
        {/* Settings */}
        <button
          onClick={() => logout()}
          className="p-1 rounded hover:bg-[var(--color-dc-bg-modifier-hover)] text-[var(--color-dc-interactive-normal)] hover:text-[var(--color-dc-interactive-hover)]"
          title="User Settings"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.477.477 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function ChannelSidebar() {
  const { guilds, activeGuildId, channels, activeChannelId, setActiveChannel } = useGuildStore();

  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const guildChannels = activeGuildId ? (channels[activeGuildId] ?? []) : [];
  const textChannels = guildChannels.filter((c) => c.type === "text");
  const voiceChannels = guildChannels.filter((c) => c.type === "voice");

  return (
    <div
      className="w-60 flex-shrink-0 flex flex-col"
      style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
    >
      {/* Guild header */}
      <div
        className="h-12 px-4 flex items-center justify-between border-b cursor-pointer hover:bg-[var(--color-dc-bg-modifier-hover)] transition-colors flex-shrink-0"
        style={{ borderColor: "var(--color-dc-bg-floating)" }}
      >
        <span className="text-[var(--color-dc-header-primary)] font-semibold text-base truncate">
          {activeGuild?.name ?? "Direct Messages"}
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--color-dc-interactive-normal)] flex-shrink-0">
          <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Channels */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {textChannels.length > 0 && (
          <div className="mb-2">
            <div className="flex items-center justify-between px-2 py-1 group">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-dc-channel-default)] group-hover:text-[var(--color-dc-interactive-hover)]">
                Text Channels
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--color-dc-channel-default)] opacity-0 group-hover:opacity-100 cursor-pointer">
                <path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z" />
              </svg>
            </div>
            {textChannels.map((ch) => (
              <ChannelItem
                key={ch.id}
                name={ch.name}
                type="text"
                active={activeChannelId === ch.id}
                onClick={() => setActiveChannel(ch.id)}
              />
            ))}
          </div>
        )}
        {voiceChannels.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 py-1 group">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-dc-channel-default)] group-hover:text-[var(--color-dc-interactive-hover)]">
                Voice Channels
              </span>
            </div>
            {voiceChannels.map((ch) => (
              <ChannelItem
                key={ch.id}
                name={ch.name}
                type="voice"
                active={activeChannelId === ch.id}
                onClick={() => setActiveChannel(ch.id)}
              />
            ))}
          </div>
        )}
        {guildChannels.length === 0 && (
          <p className="text-[var(--color-dc-text-muted)] text-sm text-center mt-4">
            No channels yet
          </p>
        )}
      </div>

      {/* User panel */}
      <div
        className="h-[52px] flex items-center px-2 flex-shrink-0"
        style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
      >
        <UserPanel />
      </div>
    </div>
  );
}
