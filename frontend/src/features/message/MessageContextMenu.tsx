import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Message } from "../../types";
import { useAuthStore } from "../../stores/authStore";
import { useGuildStore } from "../../stores/guildStore";
import { useMessageStore } from "../../stores/messageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useShowcaseOverlayStore } from "../../stores/showcaseOverlayStore";
import { EmojiPicker } from "./EmojiPicker";

const DEFAULT_QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢"];

interface Props {
  message: Message;
  x: number;
  y: number;
  onEdit: () => void;
  onDecorate: () => void;
  onClose: () => void;
}

function Icon({ path }: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="flex-shrink-0">
      <path d={path} />
    </svg>
  );
}

const ICON_EDIT = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z";
const ICON_COPY = "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z";
const ICON_DELETE = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z";
const ICON_DECORATE = "M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h4v4h-4v-4zm4 4h4v4h-4v-4z";
const ICON_SHOWCASE = "M4 3h16v2H4V3zm1 4h14v10H5V7zm2 2v6h10V9H7zm-3 10h16v2H4v-2z";
const ICON_EYE = "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z";
const ICON_ADD_REACTION = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.5 13H13v3.5h-2V15H7.5v-2H11v-3.5h2V13h3.5v2z";

function MenuItem({
  label, icon, danger, title, onClick,
}: {
  label: string;
  icon: string;
  danger?: boolean;
  title?: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-menu-item
      title={title}
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-2 h-8 rounded text-[13px] text-left transition-colors ${
        danger
          ? "hover:bg-[var(--color-dc-red)] hover:text-white"
          : "hover:bg-[var(--color-dc-brand)] hover:text-white"
      }`}
      style={{ color: danger ? "var(--color-dc-red)" : "var(--color-dc-text-normal)" }}
    >
      <span className="truncate">{label}</span>
      <span style={{ opacity: 0.85 }}>
        <Icon path={icon} />
      </span>
    </button>
  );
}

export function MessageContextMenu({ message, x, y, onEdit, onDecorate, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
  const [confirming, setConfirming] = useState(false);

  const me = useAuthStore((s) => s.user);
  const guilds = useGuildStore((s) => s.guilds);
  const recentEmojis = useSettingsStore((s) => s.recentEmojis);
  const recordEmoji = useSettingsStore((s) => s.recordEmoji);
  const toggleReaction = useMessageStore((s) => s.toggleReaction);
  const deleteMessage = useMessageStore((s) => s.deleteMessage);
  const deleteDecoration = useMessageStore((s) => s.deleteDecoration);
  const showDecorations = useSettingsStore((s) => s.showDecorations);
  const setShowDecorations = useSettingsStore((s) => s.setShowDecorations);

  const isOwn = !!me && message.author?.id === me.id;
  const isGuildOwner =
    !!message.guildId && guilds.some((g) => g.id === message.guildId && g.ownerId === me?.id);
  const canDelete = isOwn || isGuildOwner;
  const canEdit = isOwn;
  const hasText = message.content.trim().length > 0;
  const decorations = message.decorations ?? [];
  // The server also lets guild admins/moderators remove; the client only knows owners.
  const removableDecorations = decorations.filter((d) => isOwn || isGuildOwner || (!!me && d.authorId === me.id));

  const quickReactions = useMemo(() => {
    const list = [...recentEmojis];
    for (const fallback of DEFAULT_QUICK_REACTIONS) {
      if (list.length >= 5) break;
      if (!list.includes(fallback)) list.push(fallback);
    }
    return list.slice(0, 5);
  }, [recentEmojis]);

  // Position at the cursor, clamped inside the viewport (flip up/left near edges).
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const W = el.offsetWidth || 200;
    const H = el.offsetHeight || 240;
    let left = x;
    if (left + W > window.innerWidth - 8) left = x - W;
    if (left < 8) left = 8;
    let top = y;
    if (top + H > window.innerHeight - 8) top = y - H;
    if (top < 8) top = 8;
    setPos({ top, left });
  }, [x, y]);

  // Close on outside mousedown, Esc, blur and list scroll.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (pickerAnchor || confirming) return; // the picker/dialog manage their own dismissal
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirming) setConfirming(false);
      else onClose();
    }
    function onBlur() {
      if (!confirming) onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose, pickerAnchor, confirming]);

  // Focus the first item on open.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>("[data-menu-item]");
    first?.focus();
  }, []);

  // Close if the message is edited remotely while the menu is open.
  const editedAtRef = useRef(message.editedAt);
  useEffect(() => {
    if (message.editedAt !== editedAtRef.current) onClose();
  }, [message.editedAt, onClose]);

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(index + 1 + items.length) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  function react(emoji: string) {
    recordEmoji(emoji);
    void toggleReaction(message.id, message.channelId, emoji);
    onClose();
  }

  function handleDeleteClick(e: React.MouseEvent) {
    if (e.shiftKey) {
      void deleteMessage(message.id, message.channelId);
      onClose();
      return;
    }
    setConfirming(true);
  }

  function confirmDelete() {
    void deleteMessage(message.id, message.channelId);
    setConfirming(false);
    onClose();
  }

  return (
    <>
      <div
        ref={menuRef}
        role="menu"
        aria-label="Message actions"
        onKeyDown={handleMenuKeyDown}
        className="fixed z-[10000] p-1.5 rounded-lg message-menu-in"
        style={{
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          minWidth: 200,
          backgroundColor: "var(--color-dc-bg-floating)",
          boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Quick reactions */}
        <div role="group" aria-label="Quick reactions" className="flex items-center gap-0.5 px-1 pb-1.5">
          {quickReactions.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              data-menu-item
              aria-label={`React with ${emoji}`}
              onClick={() => react(emoji)}
              className="w-7 h-7 flex items-center justify-center rounded text-lg transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            data-menu-item
            aria-label="More emoji"
            title="More emoji"
            onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}
            className="w-7 h-7 flex items-center justify-center rounded text-lg transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
            style={{ color: "var(--color-dc-text-muted)" }}
          >
            …
          </button>
        </div>

        <div className="my-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />

        <MenuItem
          label="Add Reaction"
          icon={ICON_ADD_REACTION}
          onClick={(e) => setPickerAnchor(e.currentTarget.getBoundingClientRect())}
        />

        {message.author?.id && (
          <MenuItem
            label="View Showcase"
            icon={ICON_SHOWCASE}
            onClick={() => { useShowcaseOverlayStore.getState().open(message.author.id); onClose(); }}
          />
        )}

        <MenuItem
          label="Stick Pixel Art"
          icon={ICON_DECORATE}
          onClick={() => { onDecorate(); onClose(); }}
        />

        {removableDecorations.length > 0 && (
          <MenuItem
            label={removableDecorations.length === 1 ? "Remove Sticker" : `Remove ${removableDecorations.length} Stickers`}
            icon={ICON_DELETE}
            onClick={() => {
              for (const d of removableDecorations) void deleteDecoration(d.id).catch(() => {});
              onClose();
            }}
          />
        )}

        {(decorations.length > 0 || !showDecorations) && (
          <MenuItem
            label={showDecorations ? "Hide Stickers" : "Show Stickers"}
            icon={ICON_EYE}
            title="Only on this device"
            onClick={() => { setShowDecorations(!showDecorations); onClose(); }}
          />
        )}

        {(canEdit || hasText) && (
          <div className="my-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
        )}

        {canEdit && (
          <MenuItem
            label="Edit Message"
            icon={ICON_EDIT}
            onClick={() => { onEdit(); onClose(); }}
          />
        )}

        {hasText && (
          <MenuItem
            label="Copy Text"
            icon={ICON_COPY}
            onClick={() => { void navigator.clipboard?.writeText(message.content).catch(() => {}); onClose(); }}
          />
        )}

        {canDelete && (
          <>
            <div className="my-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
            <MenuItem
              label="Delete Message"
              icon={ICON_DELETE}
              danger
              title="Hold Shift to skip confirmation"
              onClick={handleDeleteClick}
            />
          </>
        )}

        {pickerAnchor &&
          createPortal(
            <EmojiPicker
              anchorRect={pickerAnchor}
              onSelect={react}
              onClose={() => setPickerAnchor(null)}
              preferAbove
            />,
            document.body
          )}
      </div>

      {confirming &&
        createPortal(
          <div
            className="fixed inset-0 z-[10002] flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
            onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirming(false); }}
            role="dialog"
            aria-modal="true"
            aria-label="Delete Message"
          >
            <div className="w-96 rounded-lg p-5 shadow-xl" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
              <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--color-dc-header-primary)" }}>
                Delete Message
              </h3>
              <p className="text-sm mb-3" style={{ color: "var(--color-dc-text-muted)" }}>
                Are you sure you want to delete this message?
              </p>
              {hasText && (
                <p className="text-sm mb-4 line-clamp-3 break-words px-3 py-2 rounded" style={{ backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" }}>
                  {message.content}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  className="px-4 py-2 rounded text-sm hover:underline"
                  style={{ color: "var(--color-dc-text-normal)" }}
                >
                  Cancel
                </button>
                <button
                  autoFocus
                  onClick={confirmDelete}
                  className="px-4 py-2 rounded text-sm font-medium text-white hover:brightness-110"
                  style={{ backgroundColor: "var(--color-dc-red)" }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <style>{`
        .message-menu-in { animation: message-menu-in 100ms ease-out; }
        @keyframes message-menu-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .message-menu-in { animation: none; } }
      `}</style>
    </>
  );
}
