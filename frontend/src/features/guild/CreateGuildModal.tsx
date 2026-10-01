import { useState, useRef, useEffect } from "react";
import { useGuildStore } from "../../stores/guildStore";
import { useAuthStore } from "../../stores/authStore";
import { parseInviteCode, goToInvite } from "../../lib/inviteLinks";

interface CreateGuildModalProps {
  onClose: () => void;
}

export function CreateGuildModal({ onClose }: CreateGuildModalProps) {
  const { user } = useAuthStore();
  const { createGuild, setActiveGuild } = useGuildStore();
  const [name, setName] = useState(`${user?.username ?? "User"}'s server`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const inviteCode = parseInviteCode(inviteInput);
  const handleJoin = () => {
    if (!inviteCode) return;
    onClose();
    goToInvite(inviteCode);
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const guild = await createGuild(name.trim());
      setActiveGuild(guild.id);
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err?.response?.data?.error ?? "Failed to create server");
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
        className="relative w-[440px] rounded-[5px] overflow-hidden"
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

        {/* Header */}
        <div className="pt-6 px-6 pb-4 text-center">
          <h2
            className="text-2xl font-bold mb-2"
            style={{ color: "var(--color-dc-header-primary)" }}
          >
            Customize Your Server
          </h2>
          <p className="text-base leading-snug" style={{ color: "var(--color-dc-text-muted)" }}>
            Give your new server a personality with a name and an icon. You can always change it later.
          </p>
        </div>

        {/* Icon upload placeholder */}
        <div className="flex justify-center mb-5">
          <div
            className="w-20 h-20 rounded-full border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors"
            style={{ borderColor: "var(--color-dc-interactive-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="mb-1" style={{ color: "var(--color-dc-interactive-normal)" }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--color-dc-interactive-normal)" }}>
              Upload
            </span>
          </div>
        </div>

        {/* Form */}
        <div className="px-6 pb-6">
          <div className="mb-4">
            <label
              className="block text-xs font-bold uppercase tracking-wide mb-2"
              style={{ color: "var(--color-dc-header-secondary)" }}
            >
              Server Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleCreate()}
              maxLength={100}
              className="w-full px-3 py-2.5 rounded text-base outline-none"
              style={{
                backgroundColor: "var(--color-dc-bg-tertiary)",
                color: "var(--color-dc-text-normal)",
                border: error ? "1px solid var(--color-dc-red)" : "1px solid transparent",
              }}
            />
            {error && (
              <p className="mt-1.5 text-xs" style={{ color: "var(--color-dc-red)" }}>
                {error}
              </p>
            )}
          </div>

          <p className="text-xs mb-6 leading-snug" style={{ color: "var(--color-dc-text-muted)" }}>
            By creating a server, you agree to Discord's{" "}
            <span
              className="cursor-pointer hover:underline"
              style={{ color: "var(--color-dc-text-link)" }}
            >
              Community Guidelines
            </span>
            .
          </p>

          <div className="mb-5 pt-4" style={{ borderTop: "1px solid var(--color-dc-bg-floating)" }}>
            <label
              className="block text-xs font-bold uppercase tracking-wide mb-2"
              style={{ color: "var(--color-dc-header-secondary)" }}
            >
              Have an invite already?
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                placeholder="Paste an invite link or code"
                className="flex-1 px-3 py-2 rounded text-sm outline-none"
                style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-normal)" }}
              />
              <button
                onClick={handleJoin}
                disabled={!inviteCode}
                className="px-3 py-2 rounded text-white text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: "var(--color-dc-brand)" }}
              >
                Join
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={onClose}
              className="text-base hover:underline"
              style={{ color: "var(--color-dc-text-normal)" }}
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={loading || !name.trim()}
              className="px-4 py-2.5 rounded text-white font-medium text-base transition-opacity disabled:opacity-50"
              style={{ backgroundColor: "var(--color-dc-brand)" }}
              onMouseEnter={(e) => !loading && (e.currentTarget.style.backgroundColor = "var(--color-dc-brand-560)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-brand)")}
            >
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
