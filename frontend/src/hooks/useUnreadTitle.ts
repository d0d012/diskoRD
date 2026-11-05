import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useUnreadBadge } from "./useUnreadBadge";

export function useUnreadTitle() {
  const { osTotal } = useUnreadBadge();
  useEffect(() => {
    if (isTauri()) return;
    const original = document.title.replace(/^\(\d+\) /, "");
    document.title = osTotal > 0 ? `(${osTotal}) ${original}` : original;
    return () => { document.title = original; };
  }, [osTotal]);
}
