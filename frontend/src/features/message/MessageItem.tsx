import { useEffect, useRef, useState } from "react";
import type { Message } from "../../types";
import "./message.css";
import { useMessageStore } from "../../stores/messageStore";
import { useMessageMenuStore } from "../../stores/messageMenuStore";
import { useLiveUser } from "../../hooks/useLiveUser";
import { Avatar } from "../../components/ui/Avatar";
import { UserProfileCard } from "../profile/UserProfileCard";
import { AddReactionButton } from "./AddReactionButton";
import { MessageContextMenu } from "./MessageContextMenu";
import { MessageContent } from "./MessageContent";
import { MessageDecorations } from "../pixelart/MessageDecorations";
import { PixelArtEditor } from "../pixelart/PixelArtEditor";
import { useDecorationPlacementStore } from "../../stores/decorationPlacementStore";

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
  const { editMessage, toggleReaction, startReply } = useMessageStore();
  // Decorating: pick or draw art in the editor, then drop it anywhere in the chat.
  const [decorating, setDecorating] = useState(false);
  const startPlacement = useDecorationPlacementStore((s) => s.start);
  const menuOpen = useMessageMenuStore((s) => s.openId === message.id);
  const menuX = useMessageMenuStore((s) => s.x);
  const menuY = useMessageMenuStore((s) => s.y);
  const openMenu = useMessageMenuStore((s) => s.open);
  const closeMenu = useMessageMenuStore((s) => s.close);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
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

  function jumpToReply() {
    const id = message.referencedMessage?.id;
    if (!id) return;
    const original = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((el) => el.dataset.messageId === id);
    if (!original) return;
    original.scrollIntoView({ behavior: "smooth", block: "center" });
    original.classList.remove("reply-highlight");
    void original.offsetWidth; // restart the animation on repeated clicks
    original.classList.add("reply-highlight");
    window.setTimeout(() => original.classList.remove("reply-highlight"), 1800);
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
      className={`group relative flex flex-wrap gap-x-4 px-4 rounded-none outline-none transition-colors duration-150 motion-reduce:transition-none hover:bg-dc-bg-message-hover ${isGrouped ? "mt-0 py-0.5" : "mt-[17px] py-1"} ${menuOpen ? "bg-dc-bg-message-hover" : ""}`}
      data-message-id={message.id}
      onContextMenu={handleContextMenu}
      onKeyDown={handleRowKeyDown}
    >
      <MessageDecorations decorations={message.decorations} />
      <div
        className={`dc-message-toolbar absolute -top-4 right-4 z-10 flex h-8 items-center rounded-[6px] bg-dc-bg-secondary p-0.5 transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto has-[[aria-expanded=true]]:opacity-100 has-[[aria-expanded=true]]:pointer-events-auto ${menuOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <AddReactionButton messageId={message.id} channelId={message.channelId} />
        <button
          type="button"
          title="Reply"
          aria-label="Reply"
          onClick={() => startReply(message)}
          className="dc-message-action dc-press flex h-7 w-7 items-center justify-center rounded-[4px] text-dc-interactive-normal transition-colors duration-150"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M10 9V5l-7 7 7 7v-4c6 0 9 2 11 5-1-7-4-11-11-11z" />
          </svg>
        </button>
        <button
          type="button"
          title="Stick Pixel Art"
          aria-label="Stick Pixel Art"
          onClick={() => setDecorating(true)}
          className="dc-message-action dc-press flex h-7 w-7 items-center justify-center rounded-[4px] text-dc-interactive-normal transition-colors duration-150"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h4v4h-4v-4zm4 4h4v4h-4v-4z" />
          </svg>
        </button>
        <button
          type="button"
          title="More"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            openMenu(message.id, rect.right, rect.bottom + 4);
          }}
          className="dc-message-action dc-press flex h-7 w-7 items-center justify-center rounded-[4px] text-dc-interactive-normal transition-colors duration-150"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
      </div>

      {message.referencedMessage && (
        <div className="relative w-full pl-14 mb-1">
          <span aria-hidden="true" className="reply-spine absolute select-none pointer-events-none" style={{ left: 20, top: 10, width: 32, height: 12, borderColor: "var(--color-dc-bg-message-hover)" }} />
          <button type="button" onClick={jumpToReply} className="reply-preview flex max-w-full items-center gap-1.5 text-xs leading-4 text-left">
            {message.referencedMessage.deleted ? (
              <span className="italic truncate">Original message was deleted</span>
            ) : (
              <>
                <span className="select-none" aria-hidden="true">
                  <Avatar name={message.referencedMessage.authorName} src={message.referencedMessage.avatarUrl} size={16} />
                </span>
                <span className="font-semibold text-dc-text-normal shrink-0 max-w-40 truncate">{message.referencedMessage.authorName}</span>{" "}
                {!message.referencedMessage.content && (
                  <svg className="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8" cy="8" r="1" />
                    <path d="m3 17 6-6 4 4 3-3 5 5" />
                  </svg>
                )}
                <span className="truncate">{message.referencedMessage.content || "Click to see attachment"}</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Out-of-flow timestamp cannot wrap or change a grouped row's height. */}
      <div className="dc-message-avatar relative w-10 flex-shrink-0 select-none" style={{ WebkitUserSelect: "none" }}>
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
            aria-hidden="true"
            className="absolute inset-x-0 top-0 invisible group-hover:visible select-none whitespace-nowrap text-[10px] leading-5 text-right"
            style={{ color: "var(--color-dc-text-muted)", WebkitUserSelect: "none" }}
          >
            {formatTime(message.createdAt)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="dc-message-body flex-1 min-w-0">
        {!isGrouped && (
          <div className="flex items-baseline gap-1 mb-0.5">
            <span
              className="font-medium text-[15px] leading-[22px] hover:underline cursor-pointer"
              style={{ color: "var(--color-dc-header-primary)" }}
              onClick={(e) => setProfileAnchor(e.currentTarget.getBoundingClientRect())}
            >
              {authorName}
            </span>
            <span className="ml-1 text-xs font-normal" style={{ color: "var(--color-dc-text-muted)" }}>
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
            <MessageContent content={message.content} attachments={message.attachments} mentionUsernames={message.mentionUsernames} />
          )}

          {/* Reactions — only rendered when present, so hover never changes layout */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 items-center">
              {message.reactions.map((r) => (
                <ReactionPill
                  key={r.emoji}
                  reaction={r}
                  onToggle={() => toggleReaction(message.id, message.channelId, r.emoji)}
                />
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
          onDecorate={() => setDecorating(true)}
          onClose={closeMenu}
        />
      )}
      {decorating && (
        <PixelArtEditor
          onPlace={(art) => { setDecorating(false); startPlacement(message.channelId, art); }}
          onClose={() => setDecorating(false)}
        />
      )}
    </div>
  );
}

function ReactionPill({ reaction, onToggle }: { reaction: NonNullable<Message["reactions"]>[number]; onToggle: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const previous = useRef<typeof reaction | null>(null);

  useEffect(() => {
    function replay(node: HTMLElement | null, className: string) {
      if (!node) return;
      node.classList.remove(className);
      void node.offsetWidth;
      node.classList.add(className);
    }
    if (previous.current ? previous.current.selfReacted !== reaction.selfReacted : reaction.selfReacted && reaction.count === 1) {
      replay(buttonRef.current, "dc-reaction-pop");
    }
    if (previous.current && previous.current.count !== reaction.count) replay(countRef.current, "dc-reaction-roll");
    previous.current = reaction;
  }, [reaction]);

  return (
    <button
      ref={buttonRef}
      onClick={onToggle}
      data-reacted={reaction.selfReacted}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.classList.remove("dc-reaction-pop");
      }}
      className="dc-reaction dc-press mb-1 flex h-[26px] cursor-pointer items-center gap-[5px] rounded-[8px] border border-dc-border-subtle bg-dc-bg-secondary px-2 text-[13px] text-dc-interactive-normal transition-colors duration-150 hover:border-white/12 hover:bg-dc-bg-composer motion-reduce:transition-none"
    >
      <span className="dc-reaction-emoji inline-block">{reaction.emoji}</span>
      <span className="inline-flex h-4 overflow-hidden font-semibold leading-4 tabular-nums">
        <span ref={countRef} onAnimationEnd={(e) => e.currentTarget.classList.remove("dc-reaction-roll")}>{reaction.count}</span>
      </span>
    </button>
  );
}
