import { useState, useRef, useEffect } from "react";
import { useGuildStore } from "../../stores/guildStore";

interface CreateChannelModalProps {
  guildId: string;
  defaultType?: "text" | "voice";
  onClose: () => void;
}

export function CreateChannelModal({ guildId, defaultType = "text", onClose }: CreateChannelModalProps) {
  const { createChannel } = useGuildStore();
  const [type, setType] = useState<"text" | "voice">(defaultType);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-format name: lowercase, spaces → hyphens
  const handleNameChange = (val: string) => {
    setName(val.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      await createChannel(guildId, name.trim(), type);
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err?.response?.data?.error ?? "Failed to create channel");
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-[460px] rounded-[5px] overflow-hidden"
        style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 transition-colors"
          style={{ color: "var(--color-dc-interactive-normal)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.4 4L12 10.4 5.6 4 4 5.6 10.4 12 4 18.4 5.6 20 12 13.6 18.4 20 20 18.4 13.6 12 20 5.6 18.4 4z" />
          </svg>
        </button>

        <div className="px-6 pt-6 pb-4 border-b" style={{ borderColor: "var(--color-dc-bg-floating)" }}>
          <h2 className="text-xl font-bold" style={{ color: "var(--color-dc-header-primary)" }}>
            Create Channel
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--color-dc-text-muted)" }}>
            in{" "}
            <span className="font-semibold" style={{ color: "var(--color-dc-text-normal)" }}>
              Text Channels
            </span>
          </p>
        </div>

        <div className="px-6 py-4">
          {/* Channel type */}
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--color-dc-header-secondary)" }}>
            Channel Type
          </p>
          <div className="flex flex-col gap-2 mb-5">
            {(["text", "voice"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors"
                style={{
                  backgroundColor: type === t ? "var(--color-dc-bg-modifier-selected)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (type !== t) e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = type === t ? "var(--color-dc-bg-modifier-selected)" : "transparent";
                }}
              >
                {t === "text" ? (
                  <span className="text-2xl w-6 text-center font-medium" style={{ color: "var(--color-dc-interactive-normal)" }}>#</span>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-interactive-normal)", flexShrink: 0 }}>
                    <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12z"/>
                    <path d="M9 9a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V9z"/>
                  </svg>
                )}
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-dc-header-primary)" }}>
                    {t === "text" ? "Text Channel" : "Voice Channel"}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>
                    {t === "text"
                      ? "Send messages, images, GIFs, emoji, opinions, and puns"
                      : "Hang out together with voice, video, and screen share"}
                  </p>
                </div>
                {/* Radio indicator */}
                <div
                  className="ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                  style={{
                    borderColor: type === t ? "var(--color-dc-brand)" : "var(--color-dc-interactive-muted)",
                  }}
                >
                  {type === t && (
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "var(--color-dc-brand)" }} />
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Name */}
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--color-dc-header-secondary)" }}>
            Channel Name
          </p>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded mb-1"
            style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
          >
            {type === "text" ? (
              <span style={{ color: "var(--color-dc-channel-default)" }}>#</span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-channel-default)" }}>
                <path d="M12 3a9 9 0 1 0 0 18A9 9 0 0 0 12 3zM2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12z"/>
                <path d="M9 9a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V9z"/>
              </svg>
            )}
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleCreate()}
              placeholder={type === "text" ? "new-channel" : "new-voice"}
              maxLength={100}
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--color-dc-text-normal)" }}
            />
          </div>
          {error && (
            <p className="text-xs mt-1" style={{ color: "var(--color-dc-red)" }}>{error}</p>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 flex justify-end gap-3"
          style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded transition-colors"
            style={{ color: "var(--color-dc-text-normal)" }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "")}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="px-4 py-2 text-sm font-medium rounded text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: "var(--color-dc-brand)" }}
            onMouseEnter={(e) => !loading && (e.currentTarget.style.backgroundColor = "var(--color-dc-brand-560)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-brand)")}
          >
            {loading ? "Creating…" : "Create Channel"}
          </button>
        </div>
      </div>
    </div>
  );
}
