import { useRef, useState } from "react";
import { useMessageStore } from "../../stores/messageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { EmojiPicker } from "./EmojiPicker";

interface AddReactionButtonProps {
  messageId: string;
  channelId: string;
}

export function AddReactionButton({ messageId, channelId }: AddReactionButtonProps) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { toggleReaction } = useMessageStore();
  const recordEmoji = useSettingsStore((s) => s.recordEmoji);

  function handleReaction(emoji: string) {
    recordEmoji(emoji);
    void toggleReaction(messageId, channelId, emoji);
    setAnchorRect(null);
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        onClick={() => {
          if (anchorRect) {
            setAnchorRect(null);
          } else if (buttonRef.current) {
            setAnchorRect(buttonRef.current.getBoundingClientRect());
          }
        }}
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

      {anchorRect && (
        <EmojiPicker
          anchorRect={anchorRect}
          onSelect={handleReaction}
          onClose={() => setAnchorRect(null)}
        />
      )}
    </div>
  );
}
