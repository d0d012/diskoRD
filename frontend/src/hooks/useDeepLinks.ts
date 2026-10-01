import { useEffect } from "react";
import { isTauri, parseInviteCode, goToInvite } from "../lib/inviteLinks";

/** Handles diskord://invite/CODE links delivered to the desktop app by the OS. */
export function useDeepLinks() {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    function handle(urls: string[] | null | undefined) {
      for (const url of urls ?? []) {
        const code = parseInviteCode(url);
        if (code) {
          goToInvite(code);
          return;
        }
      }
    }

    (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        handle(await getCurrent()); // link that launched the app
        const off = await onOpenUrl(handle); // links while the app is running
        if (cancelled) off(); else unlisten = off;
      } catch {
        // Plugin unavailable (e.g. old build) — nothing to do
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
