import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { useMessageStore } from "../../stores/messageStore";
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

export function MessageList({ channelId, channelName, intro }: Props) {
  const { messages, hasMore, fetchMessages } = useMessageStore();
  const msgs = messages[channelId] ?? [];
  const more = hasMore[channelId] ?? false;

  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const initialLoadedRef = useRef<string | null>(null);

  // Initial load
  useEffect(() => {
    if (initialLoadedRef.current === channelId) return;
    initialLoadedRef.current = channelId;
    fetchMessages(channelId);
  }, [channelId]);

  // Scroll to bottom on new messages (only if near bottom)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (isNearBottom || msgs.length <= 50) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
    if (!el || !more || loadingRef.current) return;
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
  );
}
