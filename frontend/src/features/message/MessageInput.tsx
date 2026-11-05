import { useState, useRef, useId, useEffect, useMemo } from "react";
import { useMentionCandidates } from "./useMentionCandidates";
import { useMessageStore } from "../../stores/messageStore";
import { PixelArtEditor } from "../pixelart/PixelArtEditor";
import { useDecorationPlacementStore } from "../../stores/decorationPlacementStore";

const ACCEPTED = "image/jpeg,image/png,image/gif,image/webp";
const ACCEPTED_TYPES = ACCEPTED.split(",");
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

interface Props {
  channelId: string;
  guildId: string;
  channelName: string;
  onTyping: (channelId: string, guildId: string) => void;
  /** Defaults to "Message #channel". */
  placeholder?: string;
}

// Case-insensitive match that works for both Turkish and English input:
// "ALI" finds "alice" and "IŞIK" finds "ışık", so ı and i compare equal.
function foldForSearch(value: string): string {
  return value.toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
}

export function MessageInput({ channelId, guildId, channelName, onTyping, placeholder }: Props) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [pixelArtOpen, setPixelArtOpen] = useState(false);
  const startPlacement = useDecorationPlacementStore((s) => s.start);
  const { sendMessage, uploadImage, typingUsers, replyingTo, cancelReply } = useMessageStore();
  const reply = replyingTo?.channelId === channelId ? replyingTo.message : null;
  useEffect(() => { if (reply) textareaRef.current?.focus(); }, [reply]);
  // A reply belongs to the channel it was started in, so switching channels
  // drops it (Discord-like) instead of letting it reappear on return.
  const prevChannelId = useRef(channelId);
  useEffect(() => {
    if (prevChannelId.current !== channelId) {
      prevChannelId.current = channelId;
      cancelReply();
    }
  }, [channelId, cancelReply]);
  const typingThrottleRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionListId = useId();
  const [mention, setMention] = useState<{ channelId: string; start: number; end: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dismissedMention, setDismissedMention] = useState("");
  const mentionKey = `${channelId}:${content}:${mention?.start}:${mention?.end}:${mention?.query}`;
  const mentionActive = mention?.channelId === channelId && dismissedMention !== mentionKey;
  const candidates = useMentionCandidates(guildId, channelId, mentionActive);
  const matches = useMemo(() => {
    const query = foldForSearch(mention?.query ?? "");
    return candidates.map((user) => {
      const username = foldForSearch(user.username);
      const displayName = foldForSearch(user.displayName ?? "");
      const rank = !query || username.startsWith(query) || displayName.startsWith(query) ? 0
        : username.includes(query) || displayName.includes(query) ? 1 : 2;
      return { user, rank };
    }).filter(({ rank }) => rank < 2)
      .sort((a, b) => a.rank - b.rank || a.user.username.localeCompare(b.user.username))
      .slice(0, 10).map(({ user }) => user);
  }, [candidates, mention?.query]);
  const popupOpen = mentionActive && matches.length > 0;
  const selectedIndex = Math.min(mentionIndex, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (popupOpen) document.getElementById(`${mentionListId}-${selectedIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [popupOpen, mentionListId, selectedIndex]);

  function updateMention(input: HTMLTextAreaElement) {
    const caret = input.selectionStart;
    const match = input.value.slice(0, caret).match(/(?:^|\s)@([\p{L}\p{N}_]*)$/u);
    if (!match || input.selectionStart !== input.selectionEnd) {
      setMention(null);
      return;
    }
    const query = match[1];
    setMention({
      channelId,
      start: caret - query.length - 1,
      end: caret + (input.value.slice(caret).match(/^[\p{L}\p{N}_]*/u)?.[0].length ?? 0),
      query,
    });
    setMentionIndex(0);
  }

  function selectMention(username: string) {
    if (!mention) return;
    const insertion = `@${username} `;
    const next = content.slice(0, mention.start) + insertion + content.slice(mention.end).replace(/^ /, "");
    const caret = mention.start + insertion.length;
    setContent(next);
    setMention(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

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
    setMention(null);
    const replyId = reply?.id;
    try {
      if (replyId) await sendMessage(channelId, trimmed, replyId);
      else await sendMessage(channelId, trimmed);
      if (replyId && useMessageStore.getState().replyingTo?.message.id === replyId) cancelReply();
    } catch {
      // Don't clobber anything typed while the send was in flight.
      setContent((current) => current || trimmed);
    } finally {
      setSending(false);
    }
  }

  function showUploadError(message: string) {
    setUploadError(message);
    setTimeout(() => setUploadError(""), 3000);
  }

  async function uploadFile(file: File) {
    if (sending) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      showUploadError("Only JPEG, PNG, GIF and WebP images are supported.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showUploadError("File exceeds 8MB limit.");
      return;
    }

    setSending(true);
    setUploadError("");
    try {
      const replyId = reply?.id;
      if (replyId) await uploadImage(channelId, file, "", replyId);
      else await uploadImage(channelId, file);
      if (replyId && useMessageStore.getState().replyingTo?.message.id === replyId) cancelReply();
    } catch {
      showUploadError("Upload failed.");
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;
    await uploadFile(file);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const image = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (!image) return; // plain text paste keeps the default behavior
    e.preventDefault();
    void uploadFile(image);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return;
    if (mentionActive && e.key === "Escape") {
      e.preventDefault();
      setDismissedMention(mentionKey);
      setMention(null);
      return;
    }
    if (popupOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((selectedIndex + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        selectMention(matches[selectedIndex].username);
        return;
      }
    }
    if (e.key === "Escape" && reply) { e.preventDefault(); cancelReply(); return; }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    updateMention(e.target);
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
      {reply && (
        <div className="flex items-center justify-between rounded-t-lg px-4 py-2 text-sm" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
          <span>Replying to <strong>{reply.author?.displayName ?? reply.author?.username ?? "Deleted User"}</strong></span>
          <button type="button" aria-label="Cancel reply" onClick={cancelReply}>✕</button>
        </div>
      )}
      <div
        className="relative flex items-end gap-2 px-4 py-2.5 rounded-lg"
        style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }}
      >
        {popupOpen && (
          <div
            id={mentionListId}
            role="listbox"
            aria-label="Mention members"
            className="absolute bottom-full left-0 right-0 mb-2 p-2 rounded-lg shadow-lg max-h-60 overflow-y-auto z-20"
            style={{ backgroundColor: "var(--color-dc-bg-floating)" }}
          >
            {matches.map((user, index) => (
              <button
                key={user.id}
                id={`${mentionListId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                tabIndex={-1}
                className="block w-full rounded px-3 py-2 text-left text-sm"
                style={{
                  color: "var(--color-dc-text-normal)",
                  backgroundColor: index === selectedIndex ? "var(--color-dc-bg-modifier-selected)" : "transparent",
                }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setMentionIndex(index)}
                onClick={() => selectMention(user.username)}
              >
                <span className="font-semibold">{user.displayName || user.username}</span>
                <span className="ml-2" style={{ color: "var(--color-dc-text-muted)" }}>@{user.username}</span>
              </button>
            ))}
          </div>
        )}
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="flex-shrink-0 p-1 rounded transition-colors mb-0.5"
          title="Upload image"
          style={{ color: "var(--color-dc-interactive-normal)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </button>

        <button
          onClick={() => setPixelArtOpen(true)}
          disabled={sending}
          className="flex-shrink-0 p-1 rounded transition-colors mb-0.5"
          title="Draw pixel art"
          aria-label="Draw pixel art"
          style={{ color: "var(--color-dc-interactive-normal)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h4v4h-4v-4zm4 4h4v4h-4v-4z" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          autoFocus
          rows={1}
          className="flex-1 bg-transparent text-sm outline-none resize-none max-h-36 overflow-y-auto leading-5"
          style={{
            color: "var(--color-dc-text-normal)",
            paddingTop: "2px",
          }}
          placeholder={placeholder ?? `Message #${channelName}`}
          value={content}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={popupOpen ? mentionListId : undefined}
          aria-expanded={popupOpen}
          aria-activedescendant={popupOpen ? `${mentionListId}-${selectedIndex}` : undefined}
          onChange={handleChange}
          onSelect={(e) => updateMention(e.currentTarget)}
          onBlur={() => setMention(null)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
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

      {pixelArtOpen && (
        <PixelArtEditor
          onSend={uploadFile}
          onPlace={(art) => {
            setPixelArtOpen(false);
            startPlacement(channelId, art);
          }}
          onClose={() => {
            setPixelArtOpen(false);
            textareaRef.current?.focus();
          }}
        />
      )}

      {/* Upload error */}
      {uploadError && (
        <p className="text-xs px-1 pt-0.5" style={{ color: "var(--color-dc-red, #ed4245)" }}>{uploadError}</p>
      )}

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
