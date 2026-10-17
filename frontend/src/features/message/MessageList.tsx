import { useEffect, useRef, useCallback, useState, type ReactNode } from "react";
import { useMessageStore } from "../../stores/messageStore";
import { useAuthStore } from "../../stores/authStore";
import { MessageItem } from "./MessageItem";
import type { Message } from "../../types";

interface Props {
  channelId: string;
  channelName: string;
  /** Replaces the default channel intro shown at the start of history. */
  intro?: ReactNode;
}

function isSameAuthorAndClose(a: Message, b: Message): boolean {
  if (a.author?.id !== b.author?.id) return false;
  const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return diff < 7 * 60 * 1000; // 7 minutes
}

/** Distance from the bottom (px) after which the jump-to-latest button shows. */
const JUMP_BUTTON_THRESHOLD = 300;

export function MessageList({ channelId, channelName, intro }: Props) {
  const { messages, hasMore, fetchMessages } = useMessageStore();
  const msgs = messages[channelId] ?? [];
  const more = hasMore[channelId] ?? false;
  const selfId = useAuthStore((s) => s.user?.id);

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const initialLoadedRef = useRef<string | null>(null);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);

  // Initial load
  useEffect(() => {
    if (initialLoadedRef.current === channelId) return;
    initialLoadedRef.current = channelId;
    lastMessageIdRef.current = undefined;
    setShowJump(false);
    setNewCount(0);
    fetchMessages(channelId);
  }, [channelId]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    if (isNearBottom || prevLastId == null || (appended > 0 && last.author?.id === selfId)) {
      scrollToBottom();
    } else if (appended > 0) {
      setNewCount((n) => n + appended);
    }
  }, [msgs.length]);

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
    if (fromBottom < 50) setNewCount(0);

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
        ref={containerRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        {/* Channel intro */}
        {!more && (intro ?? (
          <div className="px-4 pt-14 pb-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
            >
              <span className="text-3xl font-bold" style={{ color: "var(--color-dc-text-muted)" }}>#</span>
            </div>
            <h2
              className="text-2xl font-bold mb-1"
              style={{ color: "var(--color-dc-header-primary)" }}
            >
              Welcome to #{channelName}!
            </h2>
            <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>
              This is the start of the #{channelName} channel.
            </p>
          </div>
        ))}

        {/* Load more spinner */}
        {more && (
          <div className="flex justify-center py-4">
            <div
              className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--color-dc-brand) transparent transparent transparent" }}
            />
          </div>
        )}

        {/* Messages */}
        <div className="pb-4">
          {msgs.map((msg, i) => {
            const prev = i > 0 ? msgs[i - 1] : null;
            const grouped = prev != null && isSameAuthorAndClose(prev, msg);
            return <MessageItem key={msg.id} message={msg} isGrouped={grouped} />;
          })}
        </div>

        <div ref={bottomRef} />
      </div>

      {(showJump || newCount > 0) && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Jump to latest message"
          title="Jump to latest message"
          className="absolute bottom-3 right-5 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-colors hover:brightness-110"
          style={{
            backgroundColor: "var(--color-dc-bg-floating)",
            color: "var(--color-dc-interactive-hover)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
          </svg>
          {newCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center"
              style={{ backgroundColor: "var(--color-dc-brand)", color: "#fff" }}
            >
              {newCount > 99 ? "99+" : newCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
