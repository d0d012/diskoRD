import { useRef, useState } from "react";
import { useMessageStore } from "../../stores/messageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { EmojiPicker } from "./EmojiPicker";
import "./message.css";

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
        className="dc-message-action dc-press flex items-center justify-center w-7 h-7 rounded-[4px] text-dc-interactive-normal transition-colors duration-150"
        title="Add Reaction"
        aria-label="Add Reaction"
        aria-expanded={!!anchorRect}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M20.5 13a8.5 8.5 0 1 1-9.5-9.5M16 5h6m-3-3v6" />
          <path d="M8 14a4.5 4.5 0 0 0 8 0" />
          <circle cx="8.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
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
