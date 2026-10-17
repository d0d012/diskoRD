import { useState, useRef } from "react";
import { useMessageStore } from "../../stores/messageStore";
import { PixelArtEditor } from "../pixelart/PixelArtEditor";

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

export function MessageInput({ channelId, guildId, channelName, onTyping, placeholder }: Props) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [pixelArtOpen, setPixelArtOpen] = useState(false);
  const { sendMessage, uploadImage, typingUsers } = useMessageStore();
  const typingThrottleRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      await uploadImage(channelId, file);
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
          onChange={handleChange}
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
