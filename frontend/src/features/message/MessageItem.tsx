import { useState } from "react";
import type { Message } from "../../types";
import { useAuthStore } from "../../stores/authStore";
import { useMessageStore } from "../../stores/messageStore";

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

function Avatar({ username }: { username: string }) {
  const color = `hsl(${(username.charCodeAt(0) * 37) % 360}, 55%, 45%)`;
  return (
    <div
      className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white font-semibold text-sm select-none"
      style={{ backgroundColor: color }}
    >
      {username[0]?.toUpperCase()}
    </div>
  );
}

export function MessageItem({ message, isGrouped }: Props) {
  const user = useAuthStore((s) => s.user);
  const { editMessage, deleteMessage } = useMessageStore();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [hovered, setHovered] = useState(false);

  const isOwn = user?.id === message.author?.id;
  const authorName = message.author?.username ?? "Deleted User";

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
      className="group flex gap-4 px-4 py-0.5 rounded transition-colors relative"
      style={{
        paddingTop: isGrouped ? "1px" : "16px",
        backgroundColor: hovered ? "var(--color-dc-bg-modifier-hover)" : "transparent",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar or spacer */}
      <div className="w-10 flex-shrink-0">
        {!isGrouped ? (
          <Avatar username={authorName} />
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
          <p
            className="text-sm whitespace-pre-wrap break-words"
            style={{ color: "var(--color-dc-text-normal)" }}
          >
            {message.content}
          </p>
        )}
      </div>

      {/* Action toolbar */}
      {hovered && !editing && isOwn && (
        <div
          className="absolute right-4 top-1 flex items-center gap-1 rounded px-1 py-0.5 shadow-md"
          style={{ backgroundColor: "var(--color-dc-bg-floating)", border: "1px solid var(--color-dc-bg-modifier-hover)" }}
        >
          <ActionButton
            title="Edit"
            onClick={() => { setEditContent(message.content); setEditing(true); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </ActionButton>
          <ActionButton
            title="Delete"
            danger
            onClick={() => deleteMessage(message.id, message.channelId)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children, title, danger, onClick,
}: {
  children: React.ReactNode;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="p-1 rounded transition-colors"
      style={{ color: danger ? "var(--color-dc-red)" : "var(--color-dc-interactive-normal)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = danger
          ? "var(--color-dc-red-hover, #f04747)"
          : "var(--color-dc-interactive-hover)";
        e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = danger ? "var(--color-dc-red)" : "var(--color-dc-interactive-normal)";
        e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {children}
    </button>
  );
}
