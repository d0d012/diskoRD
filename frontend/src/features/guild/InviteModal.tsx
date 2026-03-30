import { useState, useEffect } from "react";
import { useGuildStore } from "../../stores/guildStore";

interface InviteModalProps {
  guildId: string;
  guildName: string;
  onClose: () => void;
}

export function InviteModal({ guildId, guildName, onClose }: InviteModalProps) {
  const { createInvite } = useGuildStore();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    createInvite(guildId)
      .then((c) => {
        setCode(c);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to generate invite link");
        setLoading(false);
      });
  }, [guildId]);

  const inviteUrl = code ? `${window.location.origin}/invite/${code}` : "";

  const handleCopy = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-[460px] rounded-[5px] p-6"
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

        <h2 className="text-xl font-bold mb-1" style={{ color: "var(--color-dc-header-primary)" }}>
          Invite friends to{" "}
          <span style={{ color: "var(--color-dc-header-primary)" }}>{guildName}</span>
        </h2>
        <p className="text-sm mb-5" style={{ color: "var(--color-dc-text-muted)" }}>
          Share this link with others to grant access to your server.
        </p>

        {loading && (
          <div className="flex items-center justify-center h-12">
            <div
              className="w-5 h-5 border-2 rounded-full animate-spin"
              style={{
                borderColor: "var(--color-dc-brand)",
                borderTopColor: "transparent",
              }}
            />
          </div>
        )}

        {error && (
          <p className="text-sm" style={{ color: "var(--color-dc-red)" }}>
            {error}
          </p>
        )}

        {!loading && !error && (
          <>
            <div
              className="flex items-center gap-2 p-2 rounded mb-1"
              style={{
                backgroundColor: "var(--color-dc-bg-tertiary)",
                border: "1px solid var(--color-dc-bg-floating)",
              }}
            >
              <input
                readOnly
                value={inviteUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 bg-transparent text-sm outline-none truncate font-mono"
                style={{ color: "var(--color-dc-text-normal)" }}
              />
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 rounded text-white text-sm font-semibold flex-shrink-0 transition-colors"
                style={{
                  backgroundColor: copied
                    ? "var(--color-dc-online)"
                    : "var(--color-dc-brand)",
                }}
                onMouseEnter={(e) => {
                  if (!copied)
                    e.currentTarget.style.backgroundColor = "var(--color-dc-brand-560)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = copied
                    ? "var(--color-dc-online)"
                    : "var(--color-dc-brand)";
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>
              Your invite link expires in 7 days.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
