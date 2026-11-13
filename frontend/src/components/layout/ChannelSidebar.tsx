import { useState, useRef, useEffect } from "react";
import { useShowcaseOverlayStore } from "../../stores/showcaseOverlayStore";
import { useGuildStore } from "../../stores/guildStore";
import { useAuthStore } from "../../stores/authStore";
import { useMessageStore } from "../../stores/messageStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useLiveUser } from "../../hooks/useLiveUser";
import { statusLabel } from "../../lib/avatar";
import { Avatar } from "../ui/Avatar";
import { PresenceDot } from "../ui/PresenceDot";
import { UserProfileCard } from "../../features/profile/UserProfileCard";
import { InviteModal } from "../../features/guild/InviteModal";
import { CreateChannelModal } from "../../features/channel/CreateChannelModal";
import { ServerSettingsModal } from "../../features/guild/ServerSettingsModal";
import { VoiceStatusBar } from "../../features/voice/VoiceStatusBar";
import { VolumeMenu } from "../../features/voice/VolumeMenu";
import type { Channel, PreferredStatus } from "../../types";
import { micConstraints } from "../../lib/mediaDevices";
import { normalizeChannelName } from "../../lib/channelName";
import { UserSettingsModal } from "../../features/settings/UserSettingsModal";

// ── Inline-editable channel item ────────────────────────────────────────────

interface ChannelItemProps {
  channel: Channel;
  guildId: string;
  active: boolean;
  isOwner: boolean;
  unread: boolean;
  mentionCount: number;
  onClick: () => void;
}

function ChannelItem({ channel, guildId, active, isOwner, unread, mentionCount, onClick }: ChannelItemProps) {
  const { renameChannel, deleteChannel } = useGuildStore();
  const { toggleMuteChannel, isChannelMuted } = useNotificationStore();
  const muted = isChannelMuted(channel.id);
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
    // Normalize like the create modal so Turkish letters survive and no other
    // characters get stripped (backend stores the name verbatim).
    const next = normalizeChannelName(draft);
    if (!next || next === channel.name) {
      setDraft(channel.name);
      setEditing(false);
      return;
    }
    try {
      await renameChannel(channel.id, guildId, next);
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
      <div className="relative flex items-center mx-2">
        {/* Unread pill on the left edge */}
        {unread && !active && (
          <div
            className="absolute -left-2 w-1 rounded-r-full"
            style={{ height: "8px", backgroundColor: "var(--color-dc-header-primary)" }}
          />
        )}
        <div
          onClick={onClick}
          className={`flex items-center h-8 gap-1.5 px-2 rounded-[6px] text-[15px] font-medium cursor-pointer group transition-colors duration-100 motion-reduce:transition-none relative flex-1 min-w-0 ${
            active
              ? "bg-[var(--color-dc-bg-modifier-selected)] text-[var(--color-dc-header-primary)]"
              : unread
                ? "text-[var(--color-dc-header-primary)] hover:bg-[var(--color-dc-bg-modifier-hover)]"
                : "text-[var(--color-dc-text-muted)] hover:text-[var(--color-dc-text-body)] hover:bg-[var(--color-dc-bg-modifier-hover)]"
          }`}
        >
        {channel.type === "text" ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className={`flex-shrink-0 transition-colors duration-100 motion-reduce:transition-none ${active || unread ? "text-[var(--color-dc-header-primary)]" : "text-[var(--color-dc-channel-default)] group-hover:text-[var(--color-dc-text-body)]"}`}>
            <path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0" style={{ color: "var(--color-dc-channel-default)" }}>
            <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12z"/>
            <path d="M9 9a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V9z"/>
          </svg>
        )}
        <span className={`truncate flex-1 ${unread && !active ? "font-semibold" : ""}`}>{channel.name}</span>

        {/* Mention badge (right side, hidden on hover) */}
        {mentionCount > 0 && !active && (
          <span
            className="group-hover:hidden flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-xs font-bold text-white flex items-center justify-center"
            style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}
          >
            {mentionCount > 99 ? "99+" : mentionCount}
          </span>
        )}
        {unread && !active && mentionCount === 0 && (
          <span className="group-hover:hidden w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: "var(--color-dc-header-primary)" }} />
        )}

        {/* Action icons — visible on hover */}
        <div className="hidden group-hover:flex items-center gap-0.5 ml-auto">
          {/* Mute toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleMuteChannel(channel.id); }}
            className="p-0.5 rounded transition-colors"
            title={muted ? "Unmute Channel" : "Mute Channel"}
            style={{ color: muted ? "var(--color-dc-red, #ed4245)" : "var(--color-dc-interactive-normal)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = muted ? "var(--color-dc-red, #ed4245)" : "var(--color-dc-interactive-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = muted ? "var(--color-dc-red, #ed4245)" : "var(--color-dc-interactive-normal)")}
          >
            {muted ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5zm13.5 3c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71z"/>
              </svg>
            )}
          </button>
          {isOwner && (
            <>
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
            </>
          )}
        </div>
        </div>
      </div>
      {deleteError && (
        <p className="text-xs px-3 pb-1" style={{ color: "var(--color-dc-red)" }}>{deleteError}</p>
      )}
    </>
  );
}

function VoiceParticipantAvatar({ userId, username, size = 20 }: { userId: string; username: string; size?: number }) {
  const live = useLiveUser(userId, { id: userId, username });
  return <Avatar name={live.username ?? username} src={live.avatarUrl} size={size} />;
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
  const [profileAnchor, setProfileAnchor] = useState<{ userId: string; rect: DOMRect } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(channel.name);
  const [deleteError, setDeleteError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  const commitRename = async () => {
    const next = normalizeChannelName(draft);
    if (!next || next === channel.name) { setDraft(channel.name); setEditing(false); return; }
    try { await renameChannel(channel.id, guildId, next); } catch { setDraft(channel.name); }
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
      <div className="relative flex items-center mx-2">
        <div
          onClick={onJoin}
          className={`flex items-center h-8 gap-1.5 px-2 rounded-[6px] text-[15px] font-medium cursor-pointer group transition-colors duration-100 motion-reduce:transition-none relative flex-1 min-w-0 ${
            isActive
              ? "bg-[var(--color-dc-bg-modifier-selected)] text-[var(--color-dc-header-primary)]"
              : "text-[var(--color-dc-text-muted)] hover:text-[var(--color-dc-text-body)] hover:bg-[var(--color-dc-bg-modifier-hover)]"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className={`flex-shrink-0 transition-colors duration-100 motion-reduce:transition-none ${isActive ? "text-[var(--color-dc-header-primary)]" : "text-[var(--color-dc-channel-default)] group-hover:text-[var(--color-dc-text-body)]"}`}>
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
        <div className="ml-7 mr-2 mb-1">
          {voiceParticipants!.map((p) => (
            <div
              key={p.userId}
              className="group flex items-center gap-2 px-2 py-1 rounded-[6px] cursor-default hover:bg-[var(--color-dc-bg-modifier-hover)] transition-colors duration-100 motion-reduce:transition-none"
              onContextMenu={p.userId !== currentUserId ? (e) => {
                e.preventDefault();
                setVolumeMenu({ userId: p.userId, username: p.username, x: e.clientX, y: e.clientY });
              } : undefined}
            >
              <div
                className="w-6 h-6 rounded-full flex-shrink-0 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); setProfileAnchor({ userId: p.userId, rect: e.currentTarget.getBoundingClientRect() }); }}
              >
                <VoiceParticipantAvatar userId={p.userId} username={p.username} size={24} />
              </div>
              <span
                className="text-[13px] font-medium truncate cursor-pointer text-[var(--color-dc-text-muted)] group-hover:text-[var(--color-dc-text-body)] transition-colors duration-100 motion-reduce:transition-none"
                onClick={(e) => { e.stopPropagation(); setProfileAnchor({ userId: p.userId, rect: e.currentTarget.getBoundingClientRect() }); }}
              >
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

      {profileAnchor && (
        <UserProfileCard
          userId={profileAnchor.userId}
          guildId={guildId}
          anchorRect={profileAnchor.rect}
          preferredSide="right"
          onClose={() => setProfileAnchor(null)}
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
    <div className="flex items-center justify-between mx-2 px-2 pt-4 pb-1 group text-[var(--color-dc-text-muted)] hover:text-[var(--color-dc-text-body)] transition-colors duration-100 motion-reduce:transition-none">
      <span
        className="text-[11px] font-bold uppercase tracking-[0.04em] cursor-default"
      >
        {label}
      </span>
      <button
        onClick={onAdd}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-100 motion-reduce:transition-none rounded p-0.5"
        title={`Create ${label.slice(0, -1)}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
      </button>
    </div>
  );
}

// ── User panel ───────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: PreferredStatus; label: string; description?: string }[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Away" },
  { value: "dnd", label: "Do Not Disturb", description: "You will not receive desktop notifications" },
  { value: "invisible", label: "Invisible", description: "You will appear offline" },
];

function UserPanel() {
  const { user } = useAuthStore();
  const { status, setStatus, statusError, clearStatusError } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!statusError) return;
    const timer = setTimeout(() => clearStatusError(), 3500);
    return () => clearTimeout(timer);
  }, [statusError, clearStatusError]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative w-full min-w-0">
      <div
        className="flex items-center gap-2 p-1 rounded-[6px]"
        title={user?.displayName ?? user?.username ?? ""}
      >
        {/* Avatar + status dot (clickable) */}
        <div
          className="relative flex-shrink-0 cursor-pointer"
          title="Change status"
          onClick={() => setOpen((o) => !o)}
        >
          <Avatar
            name={user?.username ?? "?"}
            src={user?.avatarUrl}
            size={32}
            status={status}
            ringColor="var(--color-dc-bg-user-panel)"
          />
        </div>

        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-sm font-semibold leading-tight truncate" style={{ color: "var(--color-dc-header-primary)" }}>
            {user?.username ?? "…"}
          </span>
          <span className="text-xs leading-tight" style={{ color: "var(--color-dc-text-muted)" }}>
            {statusLabel(status)}
          </span>
        </div>

        <div className="ml-auto flex items-center flex-shrink-0">
          <button
            onClick={() => user && useShowcaseOverlayStore.getState().open(user.id)}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[var(--color-dc-interactive-normal)] hover:text-[var(--color-dc-text-body)] hover:bg-[var(--color-dc-bg-modifier-hover)] transition-colors duration-120 motion-reduce:transition-none"
            title="My showcase"
            aria-label="My showcase"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M4 3h16v2H4V3zm1 4h14v10H5V7zm2 2v6h10V9H7zm-3 10h16v2H4v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="w-8 h-8 rounded-[6px] flex items-center justify-center text-[var(--color-dc-interactive-normal)] hover:text-[var(--color-dc-text-body)] hover:bg-[var(--color-dc-bg-modifier-hover)] transition-colors duration-120 motion-reduce:transition-none"
            title="User Settings"
            aria-label="User Settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.477.477 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.47.47 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>
        </div>
      </div>

      {showSettings && <UserSettingsModal onClose={() => setShowSettings(false)} />}

      {statusError && (
        <div
          role="status"
          className="absolute bottom-full left-0 mb-1 px-3 py-2 rounded-md text-xs font-medium shadow-xl z-[60]"
          style={{ backgroundColor: "var(--color-dc-red)", color: "#fff" }}
        >
          {statusError}
        </div>
      )}

      {/* Status dropdown */}
      {open && (
        <div
          className="dc-elevated dc-pop-in absolute bottom-full left-0 mb-1 w-48 rounded-lg p-1 z-50 [--dc-origin:bottom_left]"
          style={{ backgroundColor: "var(--color-dc-bg-floating)" }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { void setStatus(opt.value).catch(() => {}); setOpen(false); }}
              className="dc-press w-full flex items-center gap-2.5 px-2 py-2 rounded text-sm transition-colors text-left"
              style={{
                backgroundColor: status === opt.value ? "var(--color-dc-bg-modifier-selected)" : "transparent",
                color: "var(--color-dc-text-normal)",
              }}
              onMouseEnter={(e) => { if (status !== opt.value) e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)"; }}
              onMouseLeave={(e) => { if (status !== opt.value) e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <span className="relative w-3 h-3 flex-shrink-0">
                <PresenceDot status={opt.value} size={10} borderColor="var(--color-dc-bg-floating)" />
              </span>
              <span className="flex flex-col">
                <span>{opt.label}</span>
                {opt.description && (
                  <span className="text-[11px]" style={{ color: "var(--color-dc-text-muted)" }}>
                    {opt.description}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main sidebar ─────────────────────────────────────────────────────────────

export function ChannelSidebar() {
  const { guilds, activeGuildId, channels, activeChannelId, setActiveChannel } = useGuildStore();
  const { user } = useAuthStore();
  const unreadChannels = useMessageStore((s) => s.unreadChannels);
  const mentionCounts = useMessageStore((s) => s.mentionCounts);
  const { activeVoiceChannelId, joinVoice } = useVoiceStore();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
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
          className="relative z-10 h-12 px-4 flex items-center justify-between gap-2 flex-shrink-0"
          style={{ boxShadow: "var(--shadow-dc-header)" }}
        >
          <span className="font-semibold text-base truncate" style={{ color: "var(--color-dc-header-primary)" }}>
            {activeGuild?.name ?? "Direct Messages"}
          </span>
          {activeGuild && (
            <div className="flex items-center gap-1">
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
              <button
                onClick={(e) => { e.stopPropagation(); setShowServerSettings(true); }}
                className="flex-shrink-0 p-1 rounded transition-colors"
                title="Server Settings"
                style={{ color: "var(--color-dc-interactive-normal)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Channel list */}
        <div className="dc-sidebar-scrollbar flex-1 overflow-y-auto pb-2">
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
                  mentionCount={mentionCounts[ch.id] ?? 0}
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
                        const stream = await navigator.mediaDevices.getUserMedia(micConstraints());
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
          className="h-[52px] flex items-center px-2 flex-shrink-0 border-t border-white/[0.04]"
          style={{ backgroundColor: "var(--color-dc-bg-user-panel)" }}
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

      {showServerSettings && activeGuild && (
        <ServerSettingsModal
          guildId={activeGuild.id}
          guildName={activeGuild.name}
          isOwner={isOwner}
          onClose={() => setShowServerSettings(false)}
        />
      )}
    </>
  );
}
