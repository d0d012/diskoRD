import { useState, useRef, useEffect } from "react";
import { useMessageStore } from "../../stores/messageStore";

const COMMON_EMOJIS = [
  "👍", "👎", "❤️", "😂", "🔥", "🎉",
  "✅", "🤔", "👀", "🙌", "💯", "✨",
  "🙏", "😭", "😊", "🚀", "💀", "🤝",
  "💪", "💡", "😎", "🤡", "💖", "😡"
];

interface AddReactionButtonProps {
  messageId: string;
  channelId: string;
}

export function AddReactionButton({ messageId, channelId }: AddReactionButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { toggleReaction } = useMessageStore();
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  function handleReaction(emoji: string) {
    toggleReaction(messageId, channelId, emoji);
    setIsOpen(false);
  }

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-6 h-6 rounded-full transition-colors"
        style={{
          backgroundColor: "var(--color-dc-bg-tertiary)",
          border: "1px solid var(--color-dc-bg-floating)",
          color: "var(--color-dc-text-muted)"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)";
          e.currentTarget.style.border = "1px solid var(--color-dc-interactive-hover)";
          e.currentTarget.style.color = "var(--color-dc-interactive-active)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "var(--color-dc-bg-tertiary)";
          e.currentTarget.style.border = "1px solid var(--color-dc-bg-floating)";
          e.currentTarget.style.color = "var(--color-dc-text-muted)";
        }}
        title="Add Reaction"
      >
        <svg fill="currentColor" width="14" height="14" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.5 13H13v3.5h-2V15H7.5v-2H11v-3.5h2V13h3.5v2z"/>
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute z-50 p-2 shadow-xl rounded-xl grid grid-cols-6 gap-1 mb-1 bottom-full left-0"
          style={{
            backgroundColor: "var(--color-dc-bg-floating)",
            border: "1px solid var(--color-dc-background-modifier-accent)",
            width: "max-content"
          }}
        >
          {COMMON_EMOJIS.map(emoji => (
            <button
              key={emoji}
              onClick={() => handleReaction(emoji)}
              className="text-lg w-8 h-8 flex items-center justify-center rounded transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
              style={{ padding: "0" }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
