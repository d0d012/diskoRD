import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { avatarColor, statusColor, statusLabel } from "../../lib/avatar";
import { useAuthStore } from "../../stores/authStore";
import { useFriendStore } from "../../stores/friendStore";
import { useGuildStore } from "../../stores/guildStore";
import { useMessageStore } from "../../stores/messageStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useUserStore } from "../../stores/userStore";
import { claimProfileCard } from "../../stores/profileCardStore";
import { useLiveUser } from "../../hooks/useLiveUser";
import { Avatar } from "../../components/ui/Avatar";
import { AvatarLightbox } from "./AvatarLightbox";
import { ProfileShowcase } from "../pixelart/ProfileShowcase";
import { ProfileBuddies } from "../pixelart/ProfileBuddies";
import { ProfileBanner } from "../pixelart/ProfileBanner";
import { BannerPicker } from "../pixelart/BannerPicker";
import { resolveMediaUrl } from "../../lib/api";
import { RolePicker } from "../guild/RolePicker";
import { UserSettingsModal } from "../settings/UserSettingsModal";
import type { Member, PublicUser } from "../../types";

interface RoleLike {
  id: string;
  name: string;
  color: string;
}

/** Extra fields the settings preview can override before a save. */
export interface ProfilePreview extends Partial<PublicUser> {
  createdAt?: string | null;
}

interface Props {
  userId: string;
  guildId?: string | null;
  /** Member data when opened from a guild context (roles, joinedAt, role tier). */
  member?: Member | null;
  /** Whether the viewer may assign/remove roles. */
  canManageRoles?: boolean;
  anchorRect?: DOMRect;
  anchorRef?: React.RefObject<HTMLElement | null>;
  preferredSide?: "left" | "right";
  /** Render in normal flow (settings preview) instead of as a fixed popover. */
  inline?: boolean;
  /** Unsaved profile values to show on top of the live data (settings preview). */
  preview?: ProfilePreview | null;
  onClose?: () => void;
}

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function TierIcon({ tier }: { tier: string }) {
  const label = tier === "owner" ? "Owner" : tier === "admin" ? "Admin" : "Moderator";
  const color = tier === "owner" ? "#f0b132" : tier === "admin" ? "#f23f42" : "#5865f2";
  return (
    <span title={label} aria-label={label} style={{ color, display: "inline-flex" }}>
      {tier === "owner" ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2L4 5v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V5l-8-3z" />
        </svg>
      )}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
      {children}
    </p>
  );
}

export function UserProfileCard({
  userId,
  guildId,
  member,
  canManageRoles = false,
  anchorRect,
  anchorRef,
  preferredSide = "left",
  inline = false,
  preview = null,
  onClose,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const addRoleRef = useRef<HTMLButtonElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const cardId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const me = useAuthStore((s) => s.user);
  const isSelf = me?.id === userId;

  const fallback = (member ?? (isSelf ? me : { id: userId, username: "" })) as unknown as PublicUser & { createdAt?: string; role?: string; status?: string };
  const live = useLiveUser(userId, fallback);
  const view = { ...live, ...(preview ?? {}) };

  const selfStatus = useNotificationStore((s) => s.status);
  const presenceStatus = usePresenceStore((s) => s.statuses[userId]);
  const liveStatus = isSelf ? selfStatus : presenceStatus ?? member?.status ?? "offline";

  const rolesMap = useGuildStore((s) => s.roles);
  const fetchRoles = useGuildStore((s) => s.fetchRoles);
  const removeRole = useGuildStore((s) => s.removeRole);
  const guildIcon = useGuildStore((s) => (guildId ? s.guilds.find((g) => g.id === guildId)?.iconUrl ?? null : null));

  const [showPicker, setShowPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  /** A pixel art viewer or editor opened from the showcase is on top of the card. */
  const [pixelOverlay, setPixelOverlay] = useState(false);
  /** Arranging buddies on the own card. */
  const [arranging, setArranging] = useState(false);
  const [pickingBanner, setPickingBanner] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [localRoleIds, setLocalRoleIds] = useState<string[] | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const username = view.username || "Unknown";
  const displayName = view.displayName ?? username;
  const tier = member?.role ?? "member";
  const showTier = tier === "owner" || tier === "admin" || tier === "moderator";

  const assignedRoles: RoleLike[] = localRoleIds
    ? localRoleIds.map((id) => {
        const def = (rolesMap[guildId ?? ""] ?? []).find((r) => r.id === id)
          ?? (member?.roles ?? []).find((r) => r.id === id);
        return def ? { id: def.id, name: def.name, color: def.color } : null;
      }).filter((r): r is RoleLike => r !== null)
    : (member?.roles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color }));

  const canSeeRoles = assignedRoles.length > 0 || canManageRoles;
  const appJoined = formatDate((view as { createdAt?: string }).createdAt ?? (isSelf ? me?.createdAt : undefined));
  const guildJoined = guildId ? formatDate(member?.joinedAt) : null;

  // ── Data: fetch the full profile once if we don't have bio/createdAt ─────────
  useEffect(() => {
    if (inline) return;
    const existing = useUserStore.getState().users[userId];
    if (existing && (existing as { createdAt?: string }).createdAt) return;
    let cancelled = false;
    api.get(`/users/${userId}`)
      .then(({ data }) => {
        if (!cancelled && data.data) useUserStore.getState().upsertUser(data.data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, inline]);

  // Fetch role definitions for the role picker / chip colors.
  useEffect(() => {
    if (guildId && !rolesMap[guildId]) void fetchRoles(guildId);
  }, [guildId, rolesMap, fetchRoles]);

  // ── Positioning: measure the real height and clamp inside the viewport ──────
  useLayoutEffect(() => {
    if (inline) return;
    const el = cardRef.current;
    const anchor = anchorRect ?? anchorRef?.current?.getBoundingClientRect();
    if (!el || !anchor) return;
    const place = () => {
      const W = el.offsetWidth || 300;
      const H = el.offsetHeight || 320;
      let left = preferredSide === "left" ? anchor.left - W - 8 : anchor.right + 8;
      if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
      if (left < 8) left = 8;
      let top = anchor.top;
      if (top + H > window.innerHeight - 8) top = window.innerHeight - H - 8;
      if (top < 8) top = 8;
      setPos({ top, left });
    };
    place();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(place);
      ro.observe(el);
    }
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchorRect, anchorRef, preferredSide, inline]);

  // ── Close on outside mousedown, Esc and list scroll ─────────────────────────
  useEffect(() => {
    if (inline || !onClose) return;
    // Child overlays (role picker, settings, lightbox) manage their own dismissal.
    const childOpen = () => showPicker || showSettings || showLightbox || pixelOverlay || arranging || pickingBanner;
    function onDown(e: MouseEvent) {
      const target = e.target as Element;
      if (childOpen()) return;
      // The avatar lightbox is portalled outside the card; clicks there aren't "outside".
      if (target.closest?.("[data-avatar-lightbox]")) return;
      if (cardRef.current && !cardRef.current.contains(target)) onClose!();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose!();
    }
    function onScroll() {
      if (!childOpen()) onClose!();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose, inline, showPicker, showSettings, showLightbox, pixelOverlay, arranging, pickingBanner]);

  // Only one profile card is open app-wide, however it was opened.
  useEffect(() => {
    if (inline) return;
    return claimProfileCard(cardId, () => onCloseRef.current?.());
  }, [cardId, inline]);

  // ── Focus management: focus the message box, restore focus on close ─────────
  useEffect(() => {
    if (inline) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    if (!isSelf) {
      const t = setTimeout(() => messageInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isSelf, inline]);

  useEffect(() => {
    if (inline) return;
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, [inline]);

  async function handleMessageSubmit() {
    const text = message.trim();
    setSending(true);
    try {
      const dm = await useFriendStore.getState().openDM(userId);
      useGuildStore.getState().setActiveGuild(null);
      useFriendStore.getState().setActiveDM(dm.id);
      if (text) await useMessageStore.getState().sendMessage(dm.id, text);
      onClose?.();
    } catch {
      setSending(false);
    }
  }

  async function handleRemoveRole(roleId: string) {
    if (!guildId) return;
    setLocalRoleIds((prev) => (prev ?? assignedRoles.map((r) => r.id)).filter((id) => id !== roleId));
    try {
      await removeRole(guildId, userId, roleId);
    } catch {
      setLocalRoleIds(null);
    }
  }

  return (
    <>
      <div
        ref={cardRef}
        role="dialog"
        aria-label={`${displayName}'s profile`}
        className={inline ? "profile-card-in" : "fixed z-[9999] overflow-hidden profile-card-in"}
        style={{
          top: inline ? undefined : pos?.top ?? -9999,
          left: inline ? undefined : pos?.left ?? -9999,
          width: 300,
          borderRadius: 12,
          backgroundColor: "var(--color-dc-bg-floating)",
          boxShadow: inline ? "none" : "0 8px 32px rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.06)",
          overflow: "hidden",
          // One stacking context: banner < buddies behind < card content < buddies in front.
          position: inline ? "relative" : undefined,
          isolation: "isolate",
        }}
      >
        {/* Banner */}
        <ProfileBanner userId={userId} color={view.bannerColor ?? avatarColor(username)} />

        <ProfileBuddies userId={userId} isSelf={isSelf} editing={arranging} onEditingChange={setArranging} cardRef={cardRef} />
        {isSelf && !inline && !arranging && (
          <div className="absolute top-2 right-2 flex gap-1" style={{ zIndex: 5 }}>
            <button
              onClick={() => setPickingBanner((p) => !p)}
              className="flex items-center gap-1 px-2 h-6 rounded-full text-[11px] font-medium hover:brightness-125"
              style={{ backgroundColor: "rgba(0,0,0,0.45)", color: "#fff" }}
              title="Pick a pixel art banner"
            >
              ▦ Banner
            </button>
            <button
              onClick={() => { setPickingBanner(false); setArranging(true); }}
              className="flex items-center gap-1 px-2 h-6 rounded-full text-[11px] font-medium hover:brightness-125"
              style={{ backgroundColor: "rgba(0,0,0,0.45)", color: "#fff" }}
              title="Place pixel art characters on your card"
            >
              ✦ Buddies
            </button>
          </div>
        )}
        {pickingBanner && <BannerPicker userId={userId} cardRef={cardRef} onClose={() => setPickingBanner(false)} />}

        {/* Avatar + header */}
        <div className="px-3" style={{ position: "relative", zIndex: 2 }}>
          <div style={{ marginTop: -40 }} className="flex items-end gap-3">
            <div style={{ padding: 6, borderRadius: "50%", backgroundColor: "var(--color-dc-bg-floating)" }}>
              {view.avatarUrl && !inline ? (
                <button
                  type="button"
                  onClick={() => setShowLightbox(true)}
                  className="relative block rounded-full group/avatar"
                  aria-label="View avatar"
                  title="View avatar"
                >
                  <Avatar name={username} src={view.avatarUrl} size={80} status={liveStatus} ringColor="var(--color-dc-bg-floating)" />
                  <span
                    className="absolute inset-0 rounded-full hidden group-hover/avatar:flex items-center justify-center"
                    style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
                      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm.5-7H9v2H7v1h2v2h1v-2h2V9h-2z" />
                    </svg>
                  </span>
                </button>
              ) : (
                <Avatar name={username} src={view.avatarUrl} size={80} status={liveStatus} ringColor="var(--color-dc-bg-floating)" />
              )}
            </div>
          </div>

          <div className="mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-bold truncate" style={{ color: "var(--color-dc-header-primary)" }}>
                {displayName}
              </span>
              {showTier && <TierIcon tier={tier} />}
            </div>
            {view.displayName && (
              <div className="text-[13px]" style={{ color: "var(--color-dc-text-muted)" }}>
                {username}
              </div>
            )}
            {liveStatus !== "offline" && (
              <div className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: "var(--color-dc-text-muted)" }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: statusColor(liveStatus) }} />
                {statusLabel(liveStatus)}
              </div>
            )}
          </div>

          {/* Inner panel */}
          <div className="mt-3 p-3 rounded-lg flex flex-col gap-3" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
            {view.bio && (
              <div>
                <SectionLabel>About me</SectionLabel>
                <p className="text-[13px] whitespace-pre-wrap break-words" style={{ color: "var(--color-dc-text-normal)" }}>
                  {view.bio}
                </p>
              </div>
            )}

            <ProfileShowcase userId={userId} isSelf={isSelf} onOverlayChange={setPixelOverlay} />

            {(appJoined || guildJoined) && (
              <div>
                <SectionLabel>Member since</SectionLabel>
                <div className="flex flex-col gap-1.5">
                  {appJoined && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-dc-text-normal)" }}>
                      <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "var(--color-dc-brand)" }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
                          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
                        </svg>
                      </span>
                      {appJoined}
                    </div>
                  )}
                  {guildJoined && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-dc-text-normal)" }}>
                      <span className="w-4 h-4 rounded overflow-hidden flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}>
                        {guildIcon ? (
                          <img src={resolveMediaUrl(guildIcon)} alt="" className="w-full h-full object-cover" draggable={false} />
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--color-dc-text-muted)" aria-hidden="true">
                            <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.2L19.2 8 12 11.8 4.8 8 12 4.2z" />
                          </svg>
                        )}
                      </span>
                      {guildJoined}
                    </div>
                  )}
                </div>
              </div>
            )}

            {canSeeRoles && (
              <div>
                <SectionLabel>Roles</SectionLabel>
                <div className="flex flex-wrap gap-1.5">
                  {assignedRoles.map((role) => (
                    <span
                      key={role.id}
                      className="group/chip flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: `${role.color}22`, color: role.color, border: `1px solid ${role.color}44` }}
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
                      {role.name}
                      {canManageRoles && (
                        <button
                          onClick={() => handleRemoveRole(role.id)}
                          className="opacity-0 group-hover/chip:opacity-100 transition-opacity"
                          title="Remove role"
                          aria-label={`Remove ${role.name}`}
                          style={{ color: role.color }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                          </svg>
                        </button>
                      )}
                    </span>
                  ))}
                  {canManageRoles && (
                    <button
                      ref={addRoleRef}
                      onClick={() => setShowPicker(true)}
                      className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-muted)" }}
                      title="Add role"
                      aria-label="Add role"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {!inline && (
            <div className="my-3">
              {isSelf ? (
                <button
                  onClick={() => setShowSettings(true)}
                  className="w-full h-9 rounded text-sm font-medium text-white hover:brightness-110"
                  style={{ backgroundColor: "var(--color-dc-brand)" }}
                >
                  Edit Profile
                </button>
              ) : (
                <input
                  ref={messageInputRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !sending) void handleMessageSubmit(); }}
                  placeholder={`Message @${username}`}
                  disabled={sending}
                  className="w-full h-9 px-3 rounded text-sm outline-none disabled:opacity-60"
                  style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-normal)" }}
                />
              )}
            </div>
          )}
        </div>

        <style>{`
          .profile-card-in { animation: profile-card-in 120ms ease-out; }
          @keyframes profile-card-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
          @media (prefers-reduced-motion: reduce) { .profile-card-in { animation: none; } }
        `}</style>
      </div>

      {showPicker && guildId && (
        <RolePicker
          guildId={guildId}
          userId={userId}
          assignedRoleIds={assignedRoles.map((r) => r.id)}
          anchorRef={addRoleRef as React.RefObject<HTMLElement>}
          onClose={() => { setShowPicker(false); setLocalRoleIds(null); }}
        />
      )}

      {showLightbox && view.avatarUrl && (
        <AvatarLightbox src={view.avatarUrl} name={displayName} onClose={() => setShowLightbox(false)} />
      )}
      {showSettings && <UserSettingsModal onClose={() => setShowSettings(false)} initialSection="profile" />}
    </>
  );
}
