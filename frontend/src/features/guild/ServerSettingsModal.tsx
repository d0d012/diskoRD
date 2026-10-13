import { useEffect, useRef, useState } from "react";
import { RolesSettings } from "./RolesSettings";
import { useGuildStore } from "../../stores/guildStore";
import { resolveMediaUrl } from "../../lib/api";
import { AvatarCropper } from "../settings/AvatarCropper";

const MAX_ICON_BYTES = 8 * 1024 * 1024;
const ICON_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

interface Props {
  guildId: string;
  guildName: string;
  isOwner: boolean;
  onClose: () => void;
}

type NavSection = "overview" | "roles" | "danger";

export function ServerSettingsModal({ guildId, guildName, isOwner, onClose }: Props) {
  const [activeSection, setActiveSection] = useState<NavSection>("overview");
  const [name, setName] = useState(guildName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const { deleteGuild, updateGuild, uploadGuildIcon, removeGuildIcon } = useGuildStore();
  const iconUrl = useGuildStore((s) => s.guilds.find((g) => g.id === guildId)?.iconUrl ?? null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState("");
  const iconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(guildName);
  }, [guildName]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (showConfirm) setShowConfirm(false);
        else onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, showConfirm]);

  async function handleSaveOverview() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === guildName || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      await updateGuild(guildId, { name: trimmed });
    } catch {
      setSaveError("Failed to update server. Please try again.");
      setName(guildName);
    } finally {
      setSaving(false);
    }
  }

  function handleIconFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ICON_TYPES.includes(file.type)) {
      setIconError("Unsupported image type: PNG, JPEG, GIF or WebP only");
      return;
    }
    setIconError("");
    // GIFs skip the cropper so they keep their animation.
    if (file.type === "image/gif") void uploadIcon(file);
    else setCropFile(file);
  }

  async function uploadIcon(file: File) {
    if (file.size > MAX_ICON_BYTES) {
      setIconError("Image must be 8MB or smaller");
      return;
    }
    setIconBusy(true);
    setIconError("");
    try {
      await uploadGuildIcon(guildId, file);
    } catch (err) {
      setIconError(errorText(err, "Could not upload the icon"));
    } finally {
      setIconBusy(false);
    }
  }

  async function handleRemoveIcon() {
    setIconBusy(true);
    setIconError("");
    try {
      await removeGuildIcon(guildId);
    } catch (err) {
      setIconError(errorText(err, "Could not remove the icon"));
    } finally {
      setIconBusy(false);
    }
  }

  async function handleDeleteConfirm() {
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteGuild(guildId);
      onClose();
    } catch {
      setDeleteError("Failed to delete server. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9998] flex" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
      {/* Left nav */}
      <div
        className="w-56 flex-shrink-0 flex flex-col py-8 px-3 overflow-y-auto"
        style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
      >
        {/* Guild name header */}
        <p className="px-3 mb-4 text-xs font-semibold uppercase tracking-wider truncate" style={{ color: "var(--color-dc-text-muted)" }}>
          {guildName}
        </p>

        {/* Server Management section */}
        <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-dc-text-muted)" }}>
          Server Management
        </p>
        <NavItem label="Overview" active={activeSection === "overview"} onClick={() => setActiveSection("overview")} />

        {/* User Management section */}
        <p className="px-3 mt-4 mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-dc-text-muted)" }}>
          User Management
        </p>
        <NavItem label="Roles" active={activeSection === "roles"} onClick={() => setActiveSection("roles")} />

        {/* Danger Zone — owner only */}
        {isOwner && (
          <>
            <div className="my-3 mx-3 border-t" style={{ borderColor: "var(--color-dc-bg-floating)" }} />
            <NavItem
              label="Delete Server"
              active={activeSection === "danger"}
              danger
              onClick={() => setActiveSection("danger")}
            />
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 flex-shrink-0 border-b" style={{ borderColor: "var(--color-dc-bg-floating)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>
            {activeSection === "overview" ? "Overview" : activeSection === "roles" ? "Roles" : "Delete Server"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center transition-colors"
            style={{ color: "var(--color-dc-interactive-normal)" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-hidden">
          {activeSection === "overview" && (
            <div className="p-8 max-w-lg">
              <label className="block text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
                Server Icon
              </label>
              <div className="flex items-center gap-5 mb-2">
                <button
                  type="button"
                  onClick={() => iconInputRef.current?.click()}
                  disabled={!isOwner || iconBusy}
                  aria-label="Change server icon"
                  className="relative w-20 h-20 rounded-full overflow-hidden group flex-shrink-0 flex items-center justify-center disabled:cursor-default"
                  style={{ backgroundColor: "var(--color-dc-brand)" }}
                >
                  {iconUrl ? (
                    <img src={resolveMediaUrl(iconUrl)} alt="" className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <span className="text-2xl font-semibold text-white select-none">{initials(name || guildName)}</span>
                  )}
                  {isOwner && (
                    <span
                      className={`absolute inset-0 items-center justify-center text-[11px] font-semibold uppercase text-white ${iconBusy ? "flex" : "hidden group-hover:flex"}`}
                      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
                    >
                      {iconBusy ? "Uploading…" : "Change"}
                    </span>
                  )}
                </button>
                {isOwner ? (
                  <div className="min-w-0">
                    <input ref={iconInputRef} type="file" accept={ICON_TYPES.join(",")} className="hidden" onChange={handleIconFile} />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => iconInputRef.current?.click()}
                        disabled={iconBusy}
                        className="px-4 h-8 rounded text-sm font-medium text-white whitespace-nowrap hover:brightness-110 disabled:opacity-60"
                        style={{ backgroundColor: "var(--color-dc-brand)" }}
                      >
                        Upload Image
                      </button>
                      {iconUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveIcon}
                          disabled={iconBusy}
                          className="px-3 h-8 rounded text-sm font-medium whitespace-nowrap hover:underline disabled:opacity-60"
                          style={{ color: "var(--color-dc-text-normal)" }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="text-xs mt-2" style={{ color: "var(--color-dc-text-muted)" }}>
                      PNG, JPEG or WebP — you can crop it before uploading. GIFs up to 8MB.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>Only the server owner can change the icon.</p>
                )}
              </div>
              {iconError && <p className="text-sm mb-2" style={{ color: "var(--color-dc-red, #ed4245)" }}>{iconError}</p>}
              <div className="h-px my-6" style={{ backgroundColor: "var(--color-dc-bg-modifier-hover)" }} />

              <label className="block text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
                Server Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isOwner || saving}
                className="w-full px-3 py-2 rounded text-sm outline-none mb-3"
                style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-normal)" }}
              />
              {saveError && <p className="text-sm mb-3" style={{ color: "var(--color-dc-red, #ed4245)" }}>{saveError}</p>}
              {isOwner ? (
                <button
                  onClick={handleSaveOverview}
                  disabled={saving || !name.trim() || name.trim() === guildName}
                  className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-dc-brand)" }}
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              ) : (
                <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>Only the server owner can update server settings.</p>
              )}
            </div>
          )}

          {activeSection === "roles" && <RolesSettings guildId={guildId} />}

          {activeSection === "danger" && isOwner && (
            <div className="p-8 max-w-lg">
              <div
                className="rounded-lg p-6 border"
                style={{ borderColor: "var(--color-dc-red, #ed4245)", backgroundColor: "rgba(237,66,69,0.08)" }}
              >
                <h3 className="text-base font-semibold mb-1" style={{ color: "var(--color-dc-header-primary)" }}>
                  Delete this server
                </h3>
                <p className="text-sm mb-5" style={{ color: "var(--color-dc-text-muted)" }}>
                  This will permanently delete <strong style={{ color: "var(--color-dc-header-primary)" }}>{guildName}</strong> and all of its channels, messages, and members. This action cannot be undone.
                </p>
                <button
                  onClick={() => setShowConfirm(true)}
                  className="px-4 py-2 rounded text-sm font-medium text-white transition-opacity"
                  style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                >
                  Delete Server
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {cropFile && (
        <AvatarCropper
          file={cropFile}
          title="Edit Server Icon"
          onCancel={() => setCropFile(null)}
          onApply={(cropped) => {
            setCropFile(null);
            void uploadIcon(cropped);
          }}
        />
      )}

      {/* Confirmation dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
          <div
            className="w-full max-w-sm mx-4 rounded-lg p-6 shadow-xl"
            style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
          >
            <h3 className="text-lg font-bold mb-2" style={{ color: "var(--color-dc-header-primary)" }}>
              Delete "{guildName}"?
            </h3>
            <p className="text-sm mb-6" style={{ color: "var(--color-dc-text-muted)" }}>
              Are you sure you want to delete this server? All channels and messages will be permanently lost.
            </p>

            {deleteError && (
              <p className="text-sm mb-4" style={{ color: "var(--color-dc-red, #ed4245)" }}>{deleteError}</p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowConfirm(false); setDeleteError(""); }}
                disabled={deleting}
                className="px-4 py-2 rounded text-sm font-medium transition-colors"
                style={{ color: "var(--color-dc-text-normal)" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2 rounded text-sm font-medium text-white transition-opacity disabled:opacity-50"
                style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}
              >
                {deleting ? "Deleting…" : "Delete Server"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({ label, active, danger, onClick }: { label: string; active?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="px-3 py-1.5 rounded text-sm cursor-pointer transition-colors"
      style={{
        backgroundColor: active ? "var(--color-dc-bg-modifier-selected)" : "transparent",
        color: danger
          ? "var(--color-dc-red, #ed4245)"
          : active
          ? "var(--color-dc-header-primary)"
          : "var(--color-dc-text-muted)",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = "transparent";
      }}
    >
      {label}
    </div>
  );
}
