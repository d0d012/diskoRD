import { useEffect } from "react";
import { create } from "zustand";
import { useGuildStore } from "../../stores/guildStore";
import { useLiveUser } from "../../hooks/useLiveUser";
import { Avatar } from "../../components/ui/Avatar";

export interface ToastData {
  id: string;
  authorId: string;
  username: string;
  avatarUrl?: string | null;
  preview: string;
  channelId: string;
  guildId?: string;
  isMention: boolean;
}

interface ToastStore {
  toasts: ToastData[];
  push: (t: ToastData) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) =>
    set((s) => ({
      // Keep at most 3 visible; oldest drops off the bottom
      toasts: [t, ...s.toasts].slice(0, 3),
    })),
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// ── Single toast item ────────────────────────────────────────────────────────

function Toast({ toast }: { toast: ToastData }) {
  const { dismiss } = useToastStore();
  const { setActiveGuild, setActiveChannel } = useGuildStore();
  const live = useLiveUser(toast.authorId, { id: toast.authorId, username: toast.username, avatarUrl: toast.avatarUrl });

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, dismiss]);

  const preview =
    toast.preview.length > 50
      ? toast.preview.slice(0, 50) + "…"
      : toast.preview;

  function handleClick() {
    dismiss(toast.id);
    if (toast.guildId) {
      setActiveGuild(toast.guildId);
      setActiveChannel(toast.channelId);
    }
  }

  return (
    <div
      onClick={handleClick}
      className="flex items-start gap-3 px-4 py-3 rounded-lg shadow-xl cursor-pointer w-80 transition-opacity hover:opacity-90"
      style={{
        backgroundColor: "var(--color-dc-bg-floating, #18191c)",
        border: toast.isMention
          ? "1px solid var(--color-dc-brand)"
          : "1px solid var(--color-dc-bg-modifier-hover, #3a3c42)",
        animation: "slideInRight 0.2s ease-out",
      }}
    >
      {/* Avatar */}
      <Avatar name={live.username ?? toast.username} src={live.avatarUrl} size={36} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-sm font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>
            {toast.username}
          </span>
          {toast.isMention && (
            <span
              className="text-xs px-1 rounded font-semibold"
              style={{ backgroundColor: "var(--color-dc-brand)", color: "white" }}
            >
              @
            </span>
          )}
        </div>
        <p className="text-xs truncate" style={{ color: "var(--color-dc-text-muted)" }}>
          {preview}
        </p>
      </div>

      {/* Dismiss */}
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
        className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
        style={{ color: "var(--color-dc-interactive-normal)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
    </div>
  );
}

// ── Container rendered at root ───────────────────────────────────────────────

export function NotificationToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
      <div className="fixed top-4 right-4 z-[99999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <Toast toast={t} />
          </div>
        ))}
      </div>
    </>
  );
}
