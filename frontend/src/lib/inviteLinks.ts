/** Public address friends use to reach the web app; invite links always point here. */
export const PUBLIC_URL =
  (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, "") ??
  "https://diskord.ahmertezcan.com";

export function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"];
}

/**
 * Inside the desktop app `window.location.origin` is tauri://localhost (or
 * http://tauri.localhost) which is useless to anyone else, so links use the
 * public address there. In a browser the current origin is right (and keeps
 * local dev working).
 */
export function buildInviteUrl(code: string): string {
  const base = isTauri() ? PUBLIC_URL : window.location.origin;
  return `${base}/invite/${code}`;
}

const CODE = "([A-Za-z0-9_-]+)";

/** Extract an invite code from a pasted link (https or diskord://) or a bare code. */
export function parseInviteCode(input: string): string | null {
  const text = input.trim();
  const custom = text.match(new RegExp(`^diskord://(?:invite/)?${CODE}/?$`, "i"));
  if (custom) return custom[1];
  try {
    const u = new URL(text);
    const known = [PUBLIC_URL, window.location.origin].some((o) => {
      try { return new URL(o).host === u.host; } catch { return false; }
    });
    const m = u.pathname.match(new RegExp(`^/invite/${CODE}/?$`));
    if (known && m) return m[1];
    return null;
  } catch {
    return /^[A-Za-z0-9_-]{4,}$/.test(text) ? text : null;
  }
}

/** Navigate the running app to an invite without a page reload. */
export function goToInvite(code: string): void {
  window.history.pushState({}, "", `/invite/${code}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
