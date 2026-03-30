import { useState, useRef } from "react";
import { useMessageStore } from "../../stores/messageStore";

interface Props {
  channelId: string;
  guildId: string;
  channelName: string;
  onTyping: (channelId: string, guildId: string) => void;
}

export function MessageInput({ channelId, guildId, channelName, onTyping }: Props) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const { sendMessage, typingUsers } = useMessageStore();
  const typingThrottleRef = useRef(0);

  const typing = (typingUsers[channelId] ?? []).filter(
    (u) => Date.now() - u.at < 5000
  );

  function handleTyping() {
    const now = Date.now();
    if (now - typingThrottleRef.current > 3000) {
      typingThrottleRef.current = now;
      onTyping(channelId, guildId);
    }
  }

  async function handleSubmit() {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setContent("");
    try {
      await sendMessage(channelId, trimmed);
    } catch {
      setContent(trimmed); // restore on failure
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    if (e.target.value) handleTyping();
  }

  const typingText = typing.length === 0
    ? null
    : typing.length === 1
    ? `${typing[0].username} is typing...`
    : typing.length === 2
    ? `${typing[0].username} and ${typing[1].username} are typing...`
    : "Several people are typing...";

  return (
    <div className="px-4 pb-6 flex-shrink-0">
      <div
        className="flex items-end gap-2 px-4 py-2.5 rounded-lg"
        style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }}
      >
        <textarea
          rows={1}
          className="flex-1 bg-transparent text-sm outline-none resize-none max-h-36 overflow-y-auto leading-5"
          style={{
            color: "var(--color-dc-text-normal)",
            paddingTop: "2px",
          }}
          placeholder={`Message #${channelName}`}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || sending}
          className="flex-shrink-0 p-1 rounded transition-colors mb-0.5"
          style={{
            color: content.trim()
              ? "var(--color-dc-brand)"
              : "var(--color-dc-interactive-muted)",
          }}
          title="Send message"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>

      {/* Typing indicator */}
      <div className="h-5 px-1 pt-1">
        {typingText && (
          <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>
            <TypingDots />
            {" "}{typingText}
          </p>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-0.5 mr-1 align-middle">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block w-1 h-1 rounded-full animate-bounce"
          style={{
            backgroundColor: "var(--color-dc-text-muted)",
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </span>
  );
}
