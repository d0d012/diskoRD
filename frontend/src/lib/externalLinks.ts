import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./inviteLinks";

const EXTERNAL = /^(https?|mailto|tel):/i;

/** Opens a URL in the default browser on desktop, or a new tab on the web. */
export function openExternal(url: string): void {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  openUrl(url).catch(() => {});
}

/**
 * The desktop webview ignores target="_blank", so external links would either do
 * nothing or replace the app. Route them to the default browser instead. Clicks a
 * component already handled (e.g. invite links opened in-app) are left alone.
 */
export function installExternalLinkHandler(): () => void {
  if (!isTauri()) return () => {};
  function onClick(e: MouseEvent) {
    if (e.defaultPrevented || e.button !== 0) return;
    const anchor = (e.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;
    let url: URL;
    try { url = new URL(anchor.href, window.location.href); } catch { return; }
    if (!EXTERNAL.test(url.href) || url.origin === window.location.origin) return;
    e.preventDefault();
    openExternal(url.href);
  }
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
