import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useGuildStore } from "../../stores/guildStore";
import { useLiveUser } from "../../hooks/useLiveUser";
import { Avatar } from "../../components/ui/Avatar";
import "./notificationToast.css";

const TOAST_LIFETIME = 4000;

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

  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const deck = cardRef.current?.closest(".notification-deck");
    let remaining = TOAST_LIFETIME;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function resume() {
      startedAt = performance.now();
      timer = setTimeout(() => dismiss(toast.id), remaining);
    }
    function pause() {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (performance.now() - startedAt));
    }
    if (!deck?.matches(":hover")) resume();
    deck?.addEventListener("mouseenter", pause);
    deck?.addEventListener("mouseleave", resume);
    return () => {
      clearTimeout(timer);
      deck?.removeEventListener("mouseenter", pause);
      deck?.removeEventListener("mouseleave", resume);
    };
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
      ref={cardRef}
      onClick={handleClick}
      className="notification-card pointer-events-auto dc-elevated relative overflow-hidden flex items-start gap-3 px-4 py-3 rounded-[10px] cursor-pointer w-[340px] max-w-[calc(100vw-32px)]"
      style={{
        backgroundColor: "var(--color-dc-bg-floating)",
        border: toast.isMention
          ? "1px solid var(--color-dc-brand)"
          : "1px solid rgba(255,255,255,0.06)",
        "--toast-duration": `${TOAST_LIFETIME}ms`,
      } as React.CSSProperties}
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
        className="dc-press flex-shrink-0 rounded p-0.5 opacity-50 hover:opacity-100 transition-opacity"
        style={{ color: "var(--color-dc-interactive-normal)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
      <span aria-hidden="true" className="notification-progress pointer-events-none absolute bottom-0 inset-x-0 h-0.5 bg-dc-brand" />
    </div>
  );
}

// ── Container rendered at root ───────────────────────────────────────────────

export function NotificationToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      className="notification-deck fixed top-4 right-4 z-[99999] pointer-events-none"
      style={{ "--toast-count": toasts.length } as React.CSSProperties}
    >
      {toasts.map((t, index) => (
        <div key={t.id} className="notification-layer" style={{ "--toast-index": index, zIndex: toasts.length - index } as React.CSSProperties}>
          <Toast toast={t} />
        </div>
      ))}
    </div>
  );
}
