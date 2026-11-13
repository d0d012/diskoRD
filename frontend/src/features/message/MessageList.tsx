import { Fragment, useEffect, useRef, useCallback, useState, type ReactNode } from "react";
import "./message.css";
import { useMessageStore } from "../../stores/messageStore";
import { useAuthStore } from "../../stores/authStore";
import { useDecorationPlacementStore } from "../../stores/decorationPlacementStore";
import { PlaceDecoration, type Placement } from "../pixelart/PlaceDecoration";
import { encodeDoc } from "../pixelart/lib/doc";
import { MessageItem } from "./MessageItem";
import type { Message } from "../../types";

interface Props {
  channelId: string;
  channelName: string;
  /** Replaces the default channel intro shown at the start of history. */
  intro?: ReactNode;
}

/** Consecutive messages from the same author group into one block within this window. */
export const MESSAGE_GROUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function isSameAuthorAndClose(a: Message, b: Message): boolean {
  if (a.author?.id !== b.author?.id) return false;
  const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return diff < MESSAGE_GROUP_WINDOW_MS;
}

/** Distance from the bottom (px) after which the jump-to-latest button shows. */
const JUMP_BUTTON_THRESHOLD = 300;

export function MessageList({ channelId, channelName, intro }: Props) {
  const { messages, hasMore, fetchMessages } = useMessageStore();
  const msgs = messages[channelId] ?? [];
  const more = hasMore[channelId] ?? false;
  const selfId = useAuthStore((s) => s.user?.id);
  const placeDecoration = useMessageStore((s) => s.placeDecoration);
  const placingArt = useDecorationPlacementStore((s) => (s.channelId === channelId ? s.art : null));
  const cancelPlacement = useDecorationPlacementStore((s) => s.cancel);
  // The list element as state too, so the placement overlay can render against it.
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const initialLoadedRef = useRef<string | null>(null);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  // Whether the view should follow the bottom while images above it load.
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);

  // Initial load
  useEffect(() => {
    if (initialLoadedRef.current === channelId) return;
    initialLoadedRef.current = channelId;
    lastMessageIdRef.current = undefined;
    useDecorationPlacementStore.getState().cancel();
    setShowJump(false);
    setNewCount(0);
    fetchMessages(channelId);
  }, [channelId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    pinnedRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior });
    setNewCount(0);
  }, []);

  // Scroll to bottom on first load and on new messages if near bottom or we sent it.
  // Otherwise count them on the jump-to-latest button.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const last = msgs[msgs.length - 1];
    const prevLastId = lastMessageIdRef.current;
    lastMessageIdRef.current = last?.id;
    // Messages added after the previous newest one; 0 for prepends of older history.
    const prevLastIndex = prevLastId == null ? -1 : msgs.findIndex((m) => m.id === prevLastId);
    const appended = prevLastIndex < 0 ? 0 : msgs.length - 1 - prevLastIndex;

    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (prevLastId == null) {
      // Open at the bottom instantly: a smooth scroll from the top would cross the
      // load-older threshold and the prepend would interrupt it halfway.
      if (last) scrollToBottom("auto");
    } else if (isNearBottom || (appended > 0 && last.author?.id === selfId)) {
      scrollToBottom();
    } else if (appended > 0) {
      setNewCount((n) => n + appended);
    }
  }, [msgs.length]);

  useEffect(() => {
    const frames = new Set<number>();
    const unsubscribe = useMessageStore.subscribe((state, previous) => {
      const before = previous.messages[channelId];
      const after = state.messages[channelId];
      if (before === after) return;
      if (loadingRef.current || previous.hasMore[channelId] == null || !before || !after) return;
      if (after.length !== before.length + 1 || after[before.length - 1]?.id !== before[before.length - 1]?.id) return;
      const id = after[after.length - 1].id;
      const frame = requestAnimationFrame(() => {
        frames.delete(frame);
        const row = containerRef.current?.querySelector('[data-message-id="' + CSS.escape(id) + '"]');
        row?.querySelectorAll(".dc-message-body, .dc-message-avatar").forEach((el) => el.classList.add("dc-message-live"));
      });
      frames.add(frame);
    });
    return () => {
      unsubscribe();
      frames.forEach(cancelAnimationFrame);
    };
  }, [channelId]);

  // Preserve scroll position when prepending older messages
  useEffect(() => {
    const el = containerRef.current;
    if (!el || prevScrollHeightRef.current === 0) return;
    el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    prevScrollHeightRef.current = 0;
  }, [msgs]);

  const handleScroll = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJump(fromBottom > JUMP_BUTTON_THRESHOLD);
    if (fromBottom < 50) {
      pinnedRef.current = true;
      setNewCount(0);
    }

    if (!more || loadingRef.current) return;
    if (el.scrollTop > 150) return;

    loadingRef.current = true;
    prevScrollHeightRef.current = el.scrollHeight;
    const oldest = msgs[0];
    if (oldest) {
      await fetchMessages(channelId, oldest.id);
    }
    loadingRef.current = false;
  }, [channelId, more, msgs]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={(el) => { containerRef.current = el; setListEl(el); }}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
        onWheel={(e) => { if (e.deltaY < 0) pinnedRef.current = false; }}
        onKeyDown={(e) => { if (["ArrowUp", "PageUp", "Home"].includes(e.key)) pinnedRef.current = false; }}
        // Images grow the list after the scroll already ran; keep following the bottom.
        onLoadCapture={(e) => {
          // Decorations are absolutely positioned and don't change the layout.
          if (pinnedRef.current && !(e.target as Element).hasAttribute?.("data-decoration")) bottomRef.current?.scrollIntoView();
        }}
      >
        {/* Channel intro */}
        {!more && (intro ?? (
          <div className="px-4 pt-14 pb-5">
            <div className="relative mb-3 h-[68px] w-[68px]">
              <div className="dc-history-badge relative flex h-full w-full items-center justify-center rounded-full bg-dc-bg-secondary text-dc-header-primary">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" />
                </svg>
              </div>
            </div>
            <h2
              className="text-[32px] leading-tight font-extrabold tracking-[-0.02em] mb-2"
              style={{ color: "var(--color-dc-header-primary)" }}
            >
              Welcome to #{channelName}!
            </h2>
            <p className="text-[15px]" style={{ color: "var(--color-dc-text-muted)" }}>
              This is the start of the #{channelName} channel.
            </p>
          </div>
        ))}

        {/* Load more spinner */}
        {more && (
          <div className="flex justify-center py-4">
            <div
              className="w-5 h-5 rounded-full border-2 border-t-transparent motion-safe:animate-spin"
              style={{ borderColor: "var(--color-dc-brand) transparent transparent transparent" }}
            />
          </div>
        )}

        {/* Messages. One stacking context for the whole list: decorations (z-index -1)
            from any row paint behind every row's content, so text always stays on top. */}
        <div className="pb-4" style={{ isolation: "isolate" }}>
          {msgs.map((msg, i) => {
            const prev = i > 0 ? msgs[i - 1] : null;
            const grouped = !msg.replyTo && !msg.referencedMessage && prev != null && isSameAuthorAndClose(prev, msg);
            const date = new Date(msg.createdAt);
            const dayChanged = !prev || date.toDateString() !== new Date(prev.createdAt).toDateString();
            return (
              <Fragment key={msg.id}>
                {dayChanged && (
                  <div className="mx-4 my-4 flex items-center gap-2" role="separator" aria-label={date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}>
                    <span className="h-px flex-1 bg-dc-border-subtle" />
                    <time dateTime={msg.createdAt} className="shrink-0 px-2 text-xs font-semibold text-dc-text-muted">
                      {date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}
                    </time>
                    <span className="h-px flex-1 bg-dc-border-subtle" />
                  </div>
                )}
                {newCount > 0 && i === Math.max(0, msgs.length - newCount) && (
                  <div className="mx-4 my-2 flex items-center" role="separator" aria-label="New messages">
                    <span className="h-px flex-1 bg-dc-red" />
                    <span className="rounded-[3px] bg-dc-red px-[5px] py-px text-[10px] font-extrabold tracking-[0.04em] text-white">NEW</span>
                  </div>
                )}
                <MessageItem message={msg} isGrouped={grouped} />
              </Fragment>
            );
          })}
        </div>

        <div ref={bottomRef} />
      </div>

      {placingArt && listEl && (
        <PlaceDecoration
          art={placingArt}
          list={listEl}
          onPlace={async ({ messageId, ...placement }: Placement) => {
            await placeDecoration(messageId, { doc: encodeDoc(placingArt), ...placement });
            cancelPlacement();
          }}
          onCancel={cancelPlacement}
        />
      )}

      {(showJump || newCount > 0) && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          aria-label="Jump to latest message"
          title="Jump to latest message"
          className="dc-elevated dc-slide-up-in dc-press absolute bottom-3 right-5 h-8 rounded-full flex items-center justify-center gap-2 px-3.5 text-xs font-semibold transition-colors hover:brightness-110"
          style={{
            backgroundColor: "var(--color-dc-bg-secondary)",
            color: "var(--color-dc-interactive-hover)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
          </svg>
          <span>Jump to present</span>
          {newCount > 0 && (
            <span className="flex min-w-5 h-5 items-center justify-center rounded-full bg-dc-brand px-1.5 text-[11px] font-bold tabular-nums text-white">
              {newCount > 99 ? "99+" : newCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
