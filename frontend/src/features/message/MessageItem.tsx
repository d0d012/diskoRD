import { useEffect, useRef, useState } from "react";
import type { Message } from "../../types";
import { useMessageStore } from "../../stores/messageStore";
import { useMessageMenuStore } from "../../stores/messageMenuStore";
import { useLiveUser } from "../../hooks/useLiveUser";
import { Avatar } from "../../components/ui/Avatar";
import { UserProfileCard } from "../profile/UserProfileCard";
import { AddReactionButton } from "./AddReactionButton";
import { MessageContextMenu } from "./MessageContextMenu";
import { MessageContent } from "./MessageContent";

interface Props {
  message: Message;
  isGrouped: boolean; // consecutive message from same author
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return `Today at ${formatTime(iso)}`;
  if (diffDays === 1) return `Yesterday at ${formatTime(iso)}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function MessageItem({ message, isGrouped }: Props) {
  const { editMessage, toggleReaction } = useMessageStore();
  const menuOpen = useMessageMenuStore((s) => s.openId === message.id);
  const menuX = useMessageMenuStore((s) => s.x);
  const menuY = useMessageMenuStore((s) => s.y);
  const openMenu = useMessageMenuStore((s) => s.open);
  const closeMenu = useMessageMenuStore((s) => s.close);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [hovered, setHovered] = useState(false);
  const [profileAnchor, setProfileAnchor] = useState<DOMRect | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const liveAuthor = useLiveUser(message.author?.id, message.author);
  const authorName = liveAuthor?.displayName ?? liveAuthor?.username ?? "Deleted User";

  // Drop a stale open-menu id if this message unmounts while its menu is open.
  useEffect(() => {
    return () => {
      if (useMessageMenuStore.getState().openId === message.id) {
        useMessageMenuStore.getState().close();
      }
    };
  }, [message.id]);

  function handleContextMenu(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    // Let the native menu handle links, images and selected text.
    if (target.closest("a[href], img")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim() && rowRef.current?.contains(selection.anchorNode)) {
      return;
    }
    e.preventDefault();
    openMenu(message.id, e.clientX, e.clientY);
  }

  function handleRowKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const rect = rowRef.current?.getBoundingClientRect();
      if (rect) openMenu(message.id, rect.left + 24, rect.top + 12);
    }
  }

  function handleEditSubmit() {
    if (editContent.trim() && editContent !== message.content) {
      editMessage(message.id, message.channelId, editContent.trim());
    }
    setEditing(false);
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    }
    if (e.key === "Escape") {
      setEditContent(message.content);
      setEditing(false);
    }
  }

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      className="group flex gap-4 px-4 py-0.5 rounded transition-colors relative outline-none"
      style={{
        paddingTop: isGrouped ? "1px" : "16px",
        backgroundColor: hovered || menuOpen ? "var(--color-dc-bg-modifier-hover)" : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={handleContextMenu}
      onKeyDown={handleRowKeyDown}
    >
      {/* Avatar or spacer */}
      <div className="w-10 flex-shrink-0">
        {!isGrouped ? (
          <button
            onClick={(e) => setProfileAnchor(e.currentTarget.getBoundingClientRect())}
            className="block rounded-full focus:outline-none"
            aria-label={`View ${authorName}'s profile`}
          >
            <Avatar name={liveAuthor?.username ?? authorName} src={liveAuthor?.avatarUrl} size={40} />
          </button>
        ) : (
          <span
            className="invisible group-hover:visible text-xs leading-none pt-1 text-right w-full block"
            style={{ color: "var(--color-dc-text-muted)" }}
          >
            {formatTime(message.createdAt)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {!isGrouped && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span
              className="font-semibold text-sm hover:underline cursor-pointer"
              style={{ color: "var(--color-dc-header-primary)" }}
              onClick={(e) => setProfileAnchor(e.currentTarget.getBoundingClientRect())}
            >
              {authorName}
            </span>
            <span className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>
              {formatDate(message.createdAt)}
            </span>
            {message.editedAt && (
              <span className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>
                (edited)
              </span>
            )}
          </div>
        )}

        {editing ? (
          <div>
            <textarea
              className="w-full resize-none rounded px-2 py-1 text-sm outline-none"
              style={{
                backgroundColor: "var(--color-dc-bg-tertiary)",
                color: "var(--color-dc-text-normal)",
                border: "1px solid var(--color-dc-brand)",
              }}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleEditKeyDown}
              autoFocus
              rows={2}
            />
            <p className="text-xs mt-1" style={{ color: "var(--color-dc-text-muted)" }}>
              escape to{" "}
              <button
                className="hover:underline"
                style={{ color: "var(--color-dc-link)" }}
                onClick={() => { setEditContent(message.content); setEditing(false); }}
              >
                cancel
              </button>
              {" · "}enter to{" "}
              <button
                className="hover:underline"
                style={{ color: "var(--color-dc-link)" }}
                onClick={handleEditSubmit}
              >
                save
              </button>
            </p>
          </div>
        ) : (
            <MessageContent content={message.content} attachments={message.attachments} />
          )}

          {/* Reactions — only rendered when present, so hover never changes layout */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 items-center">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => toggleReaction(message.id, message.channelId, r.emoji)}
                  className="flex items-center gap-1 px-2 py-0.5 mb-1 rounded-full text-xs font-medium cursor-pointer transition-colors"
                  style={{
                    backgroundColor: r.selfReacted ? "rgba(88,101,242,0.15)" : "var(--color-dc-bg-tertiary)",
                    border: `1px solid ${r.selfReacted ? "#5865f2" : "var(--color-dc-bg-floating)"}`,
                    color: r.selfReacted ? "var(--color-dc-brand)" : "var(--color-dc-text-normal)",
                  }}
                  onMouseEnter={(e) => {
                    if (!r.selfReacted) {
                      e.currentTarget.style.backgroundColor = "var(--color-dc-background-modifier-hover)";
                      e.currentTarget.style.border = "1px solid var(--color-dc-text-muted)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!r.selfReacted) {
                      e.currentTarget.style.backgroundColor = "var(--color-dc-bg-tertiary)";
                      e.currentTarget.style.border = "1px solid var(--color-dc-bg-floating)";
                    }
                  }}
                >
                  <span>{r.emoji}</span>
                  <span className="font-semibold">{r.count}</span>
                </button>
              ))}
              <div className="mb-1">
                <AddReactionButton messageId={message.id} channelId={message.channelId} />
              </div>
            </div>
          )}
        </div>

      {profileAnchor && message.author?.id && (
        <UserProfileCard
          userId={message.author.id}
          guildId={message.guildId}
          anchorRect={profileAnchor}
          preferredSide="right"
          onClose={() => setProfileAnchor(null)}
        />
      )}
      {menuOpen && (
        <MessageContextMenu
          message={message}
          x={menuX}
          y={menuY}
          onEdit={() => { setEditContent(message.content); setEditing(true); }}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
