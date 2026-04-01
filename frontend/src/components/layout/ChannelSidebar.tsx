import { useState, useRef, useEffect } from "react";
import { useGuildStore } from "../../stores/guildStore";
import { useAuthStore } from "../../stores/authStore";
import { useMessageStore } from "../../stores/messageStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { InviteModal } from "../../features/guild/InviteModal";
import { CreateChannelModal } from "../../features/channel/CreateChannelModal";
import { VoiceStatusBar } from "../../features/voice/VoiceStatusBar";
import { VolumeMenu } from "../../features/voice/VolumeMenu";
import type { Channel } from "../../types";

// ── Inline-editable channel item ────────────────────────────────────────────

interface ChannelItemProps {
  channel: Channel;
  guildId: string;
  active: boolean;
  isOwner: boolean;
  unread: boolean;
  onClick: () => void;
}

function ChannelItem({ channel, guildId, active, isOwner, unread, onClick }: ChannelItemProps) {
  const { renameChannel, deleteChannel } = useGuildStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(channel.name);
  const [deleteError, setDeleteError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commitRename = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === channel.name) {
      setDraft(channel.name);
      setEditing(false);
      return;
    }
    try {
      await renameChannel(channel.id, guildId, trimmed);
    } catch {
      setDraft(channel.name);
    }
    setEditing(false);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteError("");
    try {
      await deleteChannel(channel.id, guildId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setDeleteError(e?.response?.data?.error ?? "Cannot delete");
      setTimeout(() => setDeleteError(""), 3000);
    }
  };

  if (editing) {
    return (
      <div className="px-2 py-1">
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-md"
          style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }}
        >
          <span style={{ color: "var(--color-dc-channel-default)" }}>
            {channel.type === "text" ? "#" : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12z"/>
                <path d="M9 9a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V9z"/>
              </svg>
            )}
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setDraft(channel.name); setEditing(false); }
            }}
            onBlur={commitRename}
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--color-dc-text-normal)" }}
            maxLength={100}
          />
        </div>
        <p className="text-xs mt-0.5 px-1" style={{ color: "var(--color-dc-text-muted)" }}>
          esc to cancel · enter to confirm
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="relative flex items-center">
        {/* Unread pill on the left edge */}
        {unread && !active && (
          <div
            className="absolute -left-2 w-1 rounded-r-full"
            style={{ height: "8px", backgroundColor: "var(--color-dc-header-primary)" }}
          />
        )}
        <div
          onClick={onClick}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm cursor-pointer group transition-colors relative flex-1"
          style={{
            backgroundColor: active ? "var(--color-dc-bg-modifier-selected)" : "",
            color: active
              ? "var(--color-dc-interactive-active)"
              : unread
              ? "var(--color-dc-header-primary)"
              : "var(--color-dc-interactive-normal)",
          }}
          onMouseEnter={(e) => {
            if (!active) e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)";
            e.currentTarget.style.color = active ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-hover)";
          }}
          onMouseLeave={(e) => {
            if (!active) e.currentTarget.style.backgroundColor = "";
            e.currentTarget.style.color = active
              ? "var(--color-dc-interactive-active)"
              : unread
              ? "var(--color-dc-header-primary)"
              : "var(--color-dc-interactive-normal)";
          }}
        >
        {channel.type === "text" ? (
          <span className="text-base leading-none flex-shrink-0" style={{ color: "var(--color-dc-channel-default)" }}>#</span>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0" style={{ color: "var(--color-dc-channel-default)" }}>
            <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12z"/>
            <path d="M9 9a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V9z"/>
          </svg>
        )}
        <span className={`truncate flex-1 ${unread && !active ? "font-semibold" : ""}`}>{channel.name}</span>

        {/* Action icons — visible on hover, owner only */}
        {isOwner && (
          <div className="hidden group-hover:flex items-center gap-0.5 ml-auto">
            {/* Edit */}
            <button
              onClick={(e) => { e.stopPropagation(); setDraft(channel.name); setEditing(true); }}
              className="p-0.5 rounded transition-colors"
              title="Edit Channel"
              style={{ color: "var(--color-dc-interactive-normal)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            {/* Delete */}
            <button
              onClick={handleDelete}
              className="p-0.5 rounded transition-colors"
              title="Delete Channel"
              style={{ color: "var(--color-dc-interactive-normal)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-red)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        )}
        </div>
      </div>
      {deleteError && (
        <p className="text-xs px-3 pb-1" style={{ color: "var(--color-dc-red)" }}>{deleteError}</p>
      )}
    </>
  );
}

// ── Voice channel item (join-on-click, shows participants) ──────────────────

interface VoiceChannelItemProps {
  channel: Channel;
  guildId: string;
  isOwner: boolean;
  isActive: boolean;
  isConnected: boolean;
  onJoin: () => void;
}

function VoiceChannelItem({ channel, guildId, isOwner, isActive, isConnected, onJoin }: VoiceChannelItemProps) {
  const { renameChannel, deleteChannel } = useGuildStore();
  const voiceParticipants = useVoiceStore((s) => s.voiceParticipants[channel.id]);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [volumeMenu, setVolumeMenu] = useState<{ userId: string; username: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(channel.name);
  const [deleteError, setDeleteError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  const commitRename = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === channel.name) { setDraft(channel.name); setEditing(false); return; }
    try { await renameChannel(channel.id, guildId, trimmed); } catch { setDraft(channel.name); }
    setEditing(false);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteError("");
    try { await deleteChannel(channel.id, guildId); } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setDeleteError(e?.response?.data?.error ?? "Cannot delete");
      setTimeout(() => setDeleteError(""), 3000);
    }
  };

  if (editing) {
    return (
      <div className="px-2 py-1">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-channel-default)", flexShrink: 0 }}>
            <path d="M12 3c-4.97 0-9 4.03-9 9v4a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H6.29A7 7 0 0 1 19 12h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-4c0-4.97-4.03-9-9-9z"/>
          </svg>
          <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setDraft(channel.name); setEditing(false); } }}
            onBlur={commitRename}
            className="flex-1 bg-transparent text-sm outline-none" style={{ color: "var(--color-dc-text-normal)" }} maxLength={100} />
        </div>
        <p className="text-xs mt-0.5 px-1" style={{ color: "var(--color-dc-text-muted)" }}>esc to cancel · enter to confirm</p>
      </div>
    );
  }

  return (
    <>
      <div className="relative flex items-center">
        <div
          onClick={onJoin}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm cursor-pointer group transition-colors relative flex-1"
          style={{
            backgroundColor: isActive ? "var(--color-dc-bg-modifier-selected)" : "",
            color: isActive ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-normal)",
          }}
          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)"; e.currentTarget.style.color = "var(--color-dc-interactive-hover)"; }}
          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = isActive ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-normal)"; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0" style={{ color: "var(--color-dc-channel-default)" }}>
            <path d="M12 3c-4.97 0-9 4.03-9 9v4a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H6.29A7 7 0 0 1 19 12h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-4c0-4.97-4.03-9-9-9z"/>
          </svg>
          <span className="truncate flex-1">{channel.name}</span>

          {/* Connected indicator */}
          {isConnected && (
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: "var(--color-dc-online, #23a55a)" }} />
          )}

          {isOwner && (
            <div className="hidden group-hover:flex items-center gap-0.5 ml-auto">
              <button onClick={(e) => { e.stopPropagation(); setDraft(channel.name); setEditing(true); }} className="p-0.5 rounded transition-colors" title="Edit Channel" style={{ color: "var(--color-dc-interactive-normal)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button onClick={handleDelete} className="p-0.5 rounded transition-colors" title="Delete Channel" style={{ color: "var(--color-dc-interactive-normal)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-red)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Participants list under channel */}
      {(voiceParticipants?.length ?? 0) > 0 && (
        <div className="ml-6 mb-1">
          {voiceParticipants!.map((p) => (
            <div
              key={p.userId}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded cursor-default"
              onContextMenu={p.userId !== currentUserId ? (e) => {
                e.preventDefault();
                setVolumeMenu({ userId: p.userId, username: p.username, x: e.clientX, y: e.clientY });
              } : undefined}
              onMouseEnter={(e) => { if (p.userId !== currentUserId) e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <div
                className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold"
                style={{ backgroundColor: `hsl(${(p.username.charCodeAt(0) * 37) % 360}, 55%, 40%)` }}
              >
                {p.username[0]?.toUpperCase()}
              </div>
              <span className="text-xs truncate" style={{ color: "var(--color-dc-text-muted)" }}>
                {p.username}
              </span>
            </div>
          ))}
        </div>
      )}

      {volumeMenu && (
        <VolumeMenu
          userId={volumeMenu.userId}
          name={volumeMenu.username}
          x={volumeMenu.x}
          y={volumeMenu.y}
          onClose={() => setVolumeMenu(null)}
        />
      )}

      {deleteError && <p className="text-xs px-3 pb-1" style={{ color: "var(--color-dc-red)" }}>{deleteError}</p>}
    </>
  );
}

// ── Category header with "+" button ─────────────────────────────────────────

function CategoryHeader({
  label,
  onAdd,
}: {
  label: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2 py-1 group">
      <span
        className="text-xs font-semibold uppercase tracking-wide cursor-default"
        style={{ color: "var(--color-dc-channel-default)" }}
      >
        {label}
      </span>
      <button
        onClick={onAdd}
        className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5"
        title={`Create ${label.slice(0, -1)}`}
        style={{ color: "var(--color-dc-channel-default)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-channel-default)")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
      </button>
    </div>
  );
}

// ── User panel ───────────────────────────────────────────────────────────────

function UserPanel() {
  const { user, logout } = useAuthStore();

  return (
    <div
      className="flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors"
      title={user?.displayName ?? user?.username ?? ""}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
    >
      <div className="relative flex-shrink-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold"
          style={{ backgroundColor: "var(--color-dc-brand)" }}
        >
          {user?.username?.[0]?.toUpperCase() ?? "?"}
        </div>
        <div
          className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
          style={{ backgroundColor: "var(--color-dc-online)", borderColor: "var(--color-dc-bg-secondary)" }}
        />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-semibold leading-tight truncate" style={{ color: "var(--color-dc-header-primary)" }}>
          {user?.username ?? "…"}
        </span>
        <span className="text-xs leading-tight" style={{ color: "var(--color-dc-text-muted)" }}>Online</span>
      </div>
      <div className="ml-auto">
        <button
          onClick={() => logout()}
          className="p-1 rounded transition-colors"
          title="Log Out"
          style={{ color: "var(--color-dc-interactive-normal)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.477.477 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main sidebar ─────────────────────────────────────────────────────────────

export function ChannelSidebar() {
  const { guilds, activeGuildId, channels, activeChannelId, setActiveChannel } = useGuildStore();
  const { user } = useAuthStore();
  const unreadChannels = useMessageStore((s) => s.unreadChannels);
  const { activeVoiceChannelId, joinVoice } = useVoiceStore();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [createChannelType, setCreateChannelType] = useState<"text" | "voice" | null>(null);

  const activeGuild = guilds.find((g) => g.id === activeGuildId);
  const isOwner = !!activeGuild && activeGuild.ownerId === user?.id;
  const guildChannels = activeGuildId ? (channels[activeGuildId] ?? []) : [];
  const textChannels = guildChannels.filter((c) => c.type === "text");
  const voiceChannels = guildChannels.filter((c) => c.type === "voice");

  return (
    <>
      <div
        className="w-60 flex-shrink-0 flex flex-col"
        style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
      >
        {/* Guild header */}
        <div
          className="h-12 px-4 flex items-center justify-between border-b flex-shrink-0 cursor-pointer transition-colors"
          style={{ borderColor: "var(--color-dc-bg-floating)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
        >
          <span className="font-semibold text-base truncate" style={{ color: "var(--color-dc-header-primary)" }}>
            {activeGuild?.name ?? "Direct Messages"}
          </span>
          {activeGuild && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowInviteModal(true); }}
              className="flex-shrink-0 p-1 rounded transition-colors"
              title="Invite People"
              style={{ color: "var(--color-dc-interactive-normal)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm-4-6a6 6 0 1 0 0 12A6 6 0 0 0 11 6z"/>
                <path d="M21 11h-2v-2h-2v2h-2v2h2v2h2v-2h2z"/>
              </svg>
            </button>
          )}
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {/* Text channels */}
          {(textChannels.length > 0 || (isOwner && activeGuildId)) && (
            <div className="mb-1">
              <CategoryHeader
                label="Text Channels"
                onAdd={() => setCreateChannelType("text")}
              />
              {textChannels.map((ch) => (
                <ChannelItem
                  key={ch.id}
                  channel={ch}
                  guildId={activeGuildId!}
                  active={activeChannelId === ch.id}
                  isOwner={isOwner}
                  unread={!!unreadChannels[ch.id]}
                  onClick={() => setActiveChannel(ch.id)}
                />
              ))}
            </div>
          )}

          {/* Voice channels */}
          {(voiceChannels.length > 0 || (isOwner && activeGuildId)) && (
            <div>
              <CategoryHeader
                label="Voice Channels"
                onAdd={() => setCreateChannelType("voice")}
              />
              {voiceChannels.map((ch) => (
                <VoiceChannelItem
                  key={ch.id}
                  channel={ch}
                  guildId={activeGuildId!}
                  isOwner={isOwner}
                  isActive={activeChannelId === ch.id}
                  isConnected={activeVoiceChannelId === ch.id}
                  onJoin={async () => {
                    if (activeVoiceChannelId !== ch.id) {
                      try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        stream.getTracks().forEach((t) => t.stop());
                      } catch { /* permission denied — join anyway, mic will be muted */ }
                    }
                    setActiveChannel(ch.id);
                    if (activeVoiceChannelId !== ch.id) {
                      joinVoice(ch.id, activeGuildId!);
                    }
                  }}
                />
              ))}
            </div>
          )}

          {guildChannels.length === 0 && activeGuildId && !isOwner && (
            <p className="text-sm text-center mt-4" style={{ color: "var(--color-dc-text-muted)" }}>
              No channels yet
            </p>
          )}

          {!activeGuildId && (
            <p className="text-sm text-center mt-8 px-4" style={{ color: "var(--color-dc-text-muted)" }}>
              Select a server to see its channels
            </p>
          )}
        </div>

        {/* Voice status bar */}
        <VoiceStatusBar />

        {/* User panel */}
        <div
          className="h-[52px] flex items-center px-2 flex-shrink-0"
          style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
        >
          <UserPanel />
        </div>
      </div>

      {showInviteModal && activeGuild && (
        <InviteModal
          guildId={activeGuild.id}
          guildName={activeGuild.name}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {createChannelType && activeGuildId && (
        <CreateChannelModal
          guildId={activeGuildId}
          defaultType={createChannelType}
          onClose={() => setCreateChannelType(null)}
        />
      )}
    </>
  );
}
