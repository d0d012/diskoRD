import { useEffect, useLayoutEffect, useRef, useState } from "react";

const COMMON_EMOJIS = [
  "👍", "👎", "❤️", "😂", "🔥", "🎉",
  "✅", "🤔", "👀", "🙌", "💯", "✨",
  "🙏", "😭", "😊", "🚀", "💀", "🤝",
  "💪", "💡", "😎", "🤡", "💖", "😡"
];

interface EmojiPickerProps {
  /** The element the picker should be positioned against. */
  anchorRect: DOMRect;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** Open above the anchor when there is room (default true). */
  preferAbove?: boolean;
}

/** Anchored grid of common emoji, clamped inside the viewport. */
export function EmojiPicker({ anchorRect, onSelect, onClose, preferAbove = true }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const W = el.offsetWidth || 220;
    const H = el.offsetHeight || 120;
    let left = anchorRect.left;
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    if (left < 8) left = 8;
    let top = preferAbove ? anchorRect.top - H - 4 : anchorRect.bottom + 4;
    if (top < 8) top = anchorRect.bottom + 4;
    if (top + H > window.innerHeight - 8) top = window.innerHeight - H - 8;
    if (top < 8) top = 8;
    setPos({ top, left });
  }, [anchorRect, preferAbove]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[10001] p-2 shadow-xl rounded-xl grid grid-cols-6 gap-1"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        backgroundColor: "var(--color-dc-bg-floating)",
        border: "1px solid var(--color-dc-background-modifier-accent, var(--color-dc-bg-modifier-hover))",
        width: "max-content",
      }}
    >
      {COMMON_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSelect(emoji)}
          aria-label={emoji}
          className="text-lg w-8 h-8 flex items-center justify-center rounded transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
          style={{ padding: 0 }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
