import { useState } from "react";
import { useGuildStore } from "../../stores/guildStore";
import { useMessageStore } from "../../stores/messageStore";
import { CreateGuildModal } from "../../features/guild/CreateGuildModal";
import { resolveMediaUrl } from "../../lib/api";
import type { Guild } from "../../types";

interface ServerIconProps {
  guild: Guild;
  active: boolean;
  unread: boolean;
  mentionCount: number;
  onClick: () => void;
}

function ServerIcon({ guild, active, unread, mentionCount, onClick }: ServerIconProps) {
  return (
    <div className="relative flex items-center mb-2 group" onClick={onClick}>
      {/* Active indicator pill */}
      <div
        className={`absolute -left-3 w-1 rounded-r-full bg-white transition-all duration-200 ${
          active ? "h-10" : unread ? "h-2 group-hover:h-5" : "h-0 group-hover:h-5"
        }`}
      />
      <div
        className={`w-12 h-12 flex items-center justify-center cursor-pointer transition-all duration-200 overflow-hidden ${
          active
            ? "rounded-2xl bg-[var(--color-dc-brand)]"
            : "rounded-[50%] group-hover:rounded-2xl bg-[var(--color-dc-bg-secondary)]"
        }`}
      >
        {guild.iconUrl ? (
          <img src={resolveMediaUrl(guild.iconUrl)} alt={guild.name} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <span className="text-white text-sm font-semibold select-none">
            {guild.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
        )}
      </div>
      {/* Mention badge */}
      {mentionCount > 0 && !active && (
        <div
          className="absolute -bottom-1 -right-1 min-w-4 h-4 px-1 rounded-full flex items-center justify-center text-white font-bold pointer-events-none"
          style={{ backgroundColor: "var(--color-dc-red)", fontSize: "10px", border: "2px solid var(--color-dc-bg-tertiary)" }}
        >
          {mentionCount > 99 ? "99+" : mentionCount}
        </div>
      )}
      {/* Tooltip */}
      <div
        className="absolute left-16 z-50 px-3 py-1.5 rounded pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap text-sm font-semibold"
        style={{
          backgroundColor: "var(--color-dc-bg-floating)",
          color: "var(--color-dc-header-primary)",
          boxShadow: "0 8px 16px rgba(0,0,0,0.24)",
        }}
      >
        {guild.name}
        {/* Arrow */}
        <div
          className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-0 h-0"
          style={{
            borderTop: "5px solid transparent",
            borderBottom: "5px solid transparent",
            borderRight: `6px solid var(--color-dc-bg-floating)`,
          }}
        />
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-8 h-px mx-auto my-1" style={{ backgroundColor: "var(--color-dc-divider)" }} />;
}

function HomeButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div className="relative flex items-center mb-2 group" onClick={onClick}>
      <div
        className={`absolute -left-3 w-1 rounded-r-full bg-white transition-all duration-200 ${
          active ? "h-10" : "h-0 group-hover:h-5"
        }`}
      />
      <div
        className={`w-12 h-12 flex items-center justify-center cursor-pointer transition-all duration-200 ${
          active
            ? "rounded-2xl bg-[var(--color-dc-brand)]"
            : "rounded-[50%] group-hover:rounded-2xl bg-[var(--color-dc-bg-secondary)] group-hover:bg-[var(--color-dc-brand)]"
        }`}
      >
        <svg width="28" height="20" viewBox="0 0 71 55" fill="white" aria-hidden="true">
          <path d="M60.105 4.898A58.55 58.55 0 0 0 45.653.415a.22.22 0 0 0-.233.11 40.784 40.784 0 0 0-1.8 3.697c-5.456-.817-10.886-.817-16.23 0-.485-1.164-1.201-2.587-1.828-3.697a.228.228 0 0 0-.233-.11 58.386 58.386 0 0 0-14.451 4.483.207.207 0 0 0-.095.082C1.578 18.73-.944 32.144.293 45.39a.244.244 0 0 0 .093.167c6.073 4.46 11.955 7.167 17.729 8.962a.23.23 0 0 0 .249-.082 42.08 42.08 0 0 0 3.627-5.9.225.225 0 0 0-.123-.312 38.772 38.772 0 0 1-5.539-2.64.228.228 0 0 1-.022-.378 31.17 31.17 0 0 0 1.1-.862.22.22 0 0 1 .23-.03c11.619 5.304 24.198 5.304 35.68 0a.219.219 0 0 1 .233.027 28.246 28.246 0 0 0 1.1.865.228.228 0 0 1-.02.378 36.384 36.384 0 0 1-5.54 2.637.227.227 0 0 0-.121.315 47.249 47.249 0 0 0 3.624 5.897.225.225 0 0 0 .249.084c5.801-1.794 11.684-4.502 17.757-8.961a.228.228 0 0 0 .092-.164c1.48-15.315-2.48-28.618-10.497-40.412a.18.18 0 0 0-.093-.084zm-36.38 32.427c-3.497 0-6.38-3.211-6.38-7.156 0-3.944 2.827-7.156 6.38-7.156 3.583 0 6.438 3.24 6.382 7.156 0 3.945-2.827 7.156-6.381 7.156zm23.593 0c-3.498 0-6.38-3.211-6.38-7.156 0-3.944 2.826-7.156 6.38-7.156 3.582 0 6.437 3.24 6.38 7.156 0 3.945-2.826 7.156-6.38 7.156z" />
        </svg>
      </div>
    </div>
  );
}

export function ServerSidebar() {
  const { guilds, activeGuildId, setActiveGuild } = useGuildStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const unreadChannels = useMessageStore((s) => s.unreadChannels);
  const mentionCounts = useMessageStore((s) => s.mentionCounts);
  const channelGuilds = useMessageStore((s) => s.channelGuilds);

  // Aggregate per-channel unread/mention state up to the guild.
  const guildUnread: Record<string, boolean> = {};
  const guildMentions: Record<string, number> = {};
  for (const [channelId, guildId] of Object.entries(channelGuilds)) {
    if (unreadChannels[channelId]) guildUnread[guildId] = true;
    if (mentionCounts[channelId]) guildMentions[guildId] = (guildMentions[guildId] ?? 0) + mentionCounts[channelId];
  }

  return (
    <>
      <nav
        className="w-[72px] flex-shrink-0 flex flex-col items-center pt-3 pb-2 overflow-y-auto overflow-x-hidden"
        style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
      >
        <HomeButton active={activeGuildId === null} onClick={() => setActiveGuild(null)} />
        <Divider />
        {guilds.map((guild) => (
          <ServerIcon
            key={guild.id}
            guild={guild}
            active={activeGuildId === guild.id}
            unread={!!guildUnread[guild.id]}
            mentionCount={guildMentions[guild.id] ?? 0}
            onClick={() => setActiveGuild(guild.id)}
          />
        ))}
        {/* Add server button */}
        <div
          className="group relative flex items-center mb-2"
          onClick={() => setShowCreateModal(true)}
        >
          <div
            className="w-12 h-12 flex items-center justify-center cursor-pointer rounded-[50%] transition-all duration-200"
            style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.borderRadius = "16px";
              el.style.backgroundColor = "var(--color-dc-online)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.borderRadius = "50%";
              el.style.backgroundColor = "var(--color-dc-bg-secondary)";
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              aria-label="Add a Server"
              className="transition-colors"
            >
              <path
                d="M9 1v16M1 9h16"
                stroke="#23a559"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="group-hover:stroke-white"
              />
            </svg>
          </div>
          {/* Tooltip */}
          <div
            className="absolute left-16 z-50 px-3 py-1.5 rounded pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap text-sm font-semibold"
            style={{
              backgroundColor: "var(--color-dc-bg-floating)",
              color: "var(--color-dc-header-primary)",
              boxShadow: "0 8px 16px rgba(0,0,0,0.24)",
            }}
          >
            Add a Server
            <div
              className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-0 h-0"
              style={{
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
                borderRight: `6px solid var(--color-dc-bg-floating)`,
              }}
            />
          </div>
        </div>
      </nav>

      {showCreateModal && <CreateGuildModal onClose={() => setShowCreateModal(false)} />}
    </>
  );
}
