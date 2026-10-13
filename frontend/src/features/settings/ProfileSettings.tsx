import { useRef, useState } from "react";
import { api, resolveMediaUrl } from "../../lib/api";
import { storage } from "../../lib/storage";
import { useAuthStore } from "../../stores/authStore";
import { useUserStore } from "../../stores/userStore";
import { UserProfileCard } from "../profile/UserProfileCard";
import { avatarColor } from "../../lib/avatar";
import { AvatarCropper } from "./AvatarCropper";
import type { User } from "../../types";

const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function errorText(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return msg ?? fallback;
}

export function ProfileSettings() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [bannerColor, setBannerColor] = useState(user?.bannerColor ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(user?.avatarUrl ?? undefined);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const bioLength = [...bio].length;
  const isCustom = !!bannerColor && !BANNER_PRESETS.includes(bannerColor.toLowerCase());

  async function persist(updated: User) {
    setUser(updated);
    useUserStore.getState().upsertUser(updated);
    await storage.set("user", JSON.stringify(updated));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.patch("/users/me", {
        displayName: displayName.trim() ? displayName.trim() : "",
        bio,
        bannerColor,
      });
      await persist(data.data as User);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(errorText(err, "Could not save your profile"));
    } finally {
      setSaving(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Unsupported image type: PNG, JPEG, GIF or WebP only");
      return;
    }
    // Reject oversized originals up front, even though non-GIFs are re-encoded.
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Image must be 8MB or smaller");
      return;
    }
    setError("");
    // GIFs skip the cropper so they keep their animation.
    // Other images are re-encoded to 512px by the cropper.
    if (file.type === "image/gif") void uploadAvatar(file);
    else setCropFile(file);
  }

  async function uploadAvatar(file: File) {
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Image must be 8MB or smaller");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post("/users/me/avatar", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const updated = data.data as User;
      await persist(updated);
      setAvatarUrl(updated.avatarUrl ?? undefined);
    } catch (err) {
      setError(errorText(err, "Could not upload the image"));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveAvatar() {
    setUploading(true);
    setError("");
    try {
      const { data } = await api.delete("/users/me/avatar");
      const updated = data.data as User;
      await persist(updated);
      setAvatarUrl(undefined);
    } catch (err) {
      setError(errorText(err, "Could not remove the avatar"));
    } finally {
      setUploading(false);
    }
  }

  const initial = {
    displayName: user.displayName ?? "",
    bio: user.bio ?? "",
    bannerColor: user.bannerColor ?? "",
  };
  const dirty =
    displayName !== initial.displayName || bio !== initial.bio || bannerColor.toLowerCase() !== initial.bannerColor.toLowerCase();

  function handleReset() {
    setDisplayName(initial.displayName);
    setBio(initial.bio);
    setBannerColor(initial.bannerColor);
    setError("");
  }

  const defaultBanner = avatarColor(user.username);

  return (
    <div className="min-h-full flex flex-col">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Form */}
        <div className="min-w-0 flex flex-col">
          {/* Avatar */}
          <Field label="Avatar">
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative w-20 h-20 rounded-full overflow-hidden group flex-shrink-0"
                disabled={uploading}
                aria-label="Change avatar"
              >
                {avatarUrl ? (
                  <img src={resolveMediaUrl(avatarUrl)} alt="" className="w-full h-full object-cover" draggable={false} />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-2xl font-semibold text-white" style={{ backgroundColor: defaultBanner }}>
                    {user.username[0]?.toUpperCase()}
                  </span>
                )}
                <span
                  className={`absolute inset-0 items-center justify-center text-[11px] font-semibold uppercase text-white ${uploading ? "flex" : "hidden group-hover:flex"}`}
                  style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
                >
                  {uploading ? "Uploading…" : "Change"}
                </span>
              </button>
              <div className="min-w-0">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={handleFile} />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="px-4 h-8 rounded text-sm font-medium text-white whitespace-nowrap hover:brightness-110 disabled:opacity-60"
                    style={{ backgroundColor: "var(--color-dc-brand)" }}
                  >
                    Change Avatar
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      disabled={uploading}
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
            </div>
          </Field>

          {/* Display name */}
          <Field label="Display name" htmlFor="profile-display-name" hint={`Shown instead of your username. Leave empty to use ${user.username}.`}>
            <input
              id="profile-display-name"
              value={displayName}
              maxLength={64}
              placeholder={user.username}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full h-10 px-3 rounded text-sm outline-none focus:ring-2 focus:ring-[var(--color-dc-brand)]"
              style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-normal)" }}
            />
          </Field>

          {/* About me */}
          <Field label="About me" htmlFor="profile-bio" hint="Shown on your profile card.">
            <div className="relative">
              <textarea
                id="profile-bio"
                value={bio}
                rows={4}
                placeholder="Tell people a little about yourself"
                onChange={(e) => setBio(e.target.value)}
                className="w-full px-3 pt-2 pb-6 rounded text-sm outline-none resize-none block focus:ring-2 focus:ring-[var(--color-dc-brand)]"
                style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-normal)" }}
              />
              <span
                className="absolute right-2.5 bottom-1.5 text-[11px] tabular-nums pointer-events-none"
                style={{ color: bioLength > 190 ? "var(--color-dc-red)" : "var(--color-dc-text-muted)" }}
              >
                {bioLength}/190
              </span>
            </div>
          </Field>

          {/* Banner color */}
          <Field label="Banner color" last>
            <div className="flex flex-wrap items-center gap-2.5">
              <Swatch
                color={defaultBanner}
                selected={!bannerColor}
                label="Default"
                onClick={() => setBannerColor("")}
              />
              {BANNER_PRESETS.map((c) => (
                <Swatch key={c} color={c} selected={bannerColor.toLowerCase() === c} label={c} onClick={() => setBannerColor(c)} />
              ))}
              <label
                className="relative w-7 h-7 flex-shrink-0 rounded-full cursor-pointer flex items-center justify-center"
                title="Custom color"
                style={{
                  backgroundColor: isCustom ? bannerColor : "var(--color-dc-bg-tertiary)",
                  boxShadow: isCustom ? "0 0 0 2px var(--color-dc-bg-primary), 0 0 0 4px var(--color-dc-header-primary)" : undefined,
                  color: "var(--color-dc-interactive-normal)",
                }}
              >
                {!isCustom && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                  </svg>
                )}
                <input
                  type="color"
                  value={bannerColor || "#5865f2"}
                  onChange={(e) => setBannerColor(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Custom banner color"
                />
              </label>
            </div>
          </Field>

        </div>

        {/* Live preview */}
        <div className="hidden lg:block" aria-hidden="true">
          <div className="sticky top-0">
            <SectionHeading>Preview</SectionHeading>
            <UserProfileCard
              userId={user.id}
              inline
              preview={{
                displayName: displayName.trim() ? displayName : null,
                bio: bio.trim() ? bio : null,
                bannerColor: bannerColor || null,
                avatarUrl: avatarUrl ?? null,
                createdAt: user.createdAt,
              }}
            />
          </div>
        </div>
      </div>
      {cropFile && (
        <AvatarCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onApply={(cropped) => {
            setCropFile(null);
            void uploadAvatar(cropped);
          }}
        />
      )}
      <div className="h-6 flex-shrink-0" />
      {/* Unsaved changes bar */}
      {(dirty || error) && (
        <div
          className="sticky bottom-0 flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-lg"
          style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
        >
          <p className="flex-1 min-w-0 text-sm truncate" style={{ color: error ? "var(--color-dc-red)" : "var(--color-dc-text-normal)" }}>
            {error || "Careful — you have unsaved changes!"}
          </p>
          {dirty && (
            <>
              <button type="button" onClick={handleReset} disabled={saving}
                className="px-3 h-8 rounded text-sm hover:underline" style={{ color: "var(--color-dc-text-normal)" }}>
                Reset
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || bioLength > 190}
                className="px-4 h-8 rounded text-sm font-medium text-white whitespace-nowrap hover:brightness-110 disabled:opacity-60"
                style={{ backgroundColor: "var(--color-dc-online)" }}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </>
          )}
        </div>
      )}
      {saved && !dirty && (
        <p className="mt-auto pt-4 text-sm" style={{ color: "var(--color-dc-online)" }}>Profile saved</p>
      )}
    </div>
  );
}

const BANNER_PRESETS = ["#5865f2", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#1abc9c", "#9b59b6"];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
      {children}
    </h3>
  );
}

function Field({ label, htmlFor, hint, last, children }: {
  label: string;
  htmlFor?: string;
  hint?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={last ? "pt-5" : "py-5 border-b first:pt-0"}
      style={{ borderColor: "var(--color-dc-bg-modifier-hover)" }}
    >
      <label htmlFor={htmlFor} className="block">
        <SectionHeading>{label}</SectionHeading>
      </label>
      {children}
      {hint && <p className="text-xs mt-2" style={{ color: "var(--color-dc-text-muted)" }}>{hint}</p>}
    </section>
  );
}

function Swatch({ color, selected, label, onClick }: { color: string; selected: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className="w-7 h-7 rounded-full flex-shrink-0 transition-transform hover:scale-110"
      style={{
        backgroundColor: color,
        boxShadow: selected ? "0 0 0 2px var(--color-dc-bg-primary), 0 0 0 4px var(--color-dc-header-primary)" : undefined,
      }}
    />
  );
}
