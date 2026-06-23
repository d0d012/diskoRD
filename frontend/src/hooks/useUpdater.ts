import { useEffect, useState } from "react";

function isTauri() {
  return !!((window as unknown) as Record<string, unknown>)["__TAURI_INTERNALS__"];
}

export function useUpdater() {
  const [updateReady, setUpdateReady] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    async function checkForUpdate() {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (cancelled || !update?.available) return;
        setUpdateVersion(update.version ?? null);

        await update.downloadAndInstall();
        if (!cancelled) setUpdateReady(true);
      } catch {
        // Silently ignore — update check failures should never surface to users
      }
    }

    checkForUpdate();
    return () => { cancelled = true; };
  }, []);

  async function restartApp() {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      window.location.reload();
    }
  }

  return { updateReady, updateVersion, restartApp };
}
