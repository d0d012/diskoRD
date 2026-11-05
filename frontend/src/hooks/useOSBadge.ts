import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { useUnreadBadge } from "./useUnreadBadge";
import { DM_MESSAGE_EVENT } from "../lib/dmMessageEvent";
import type { Message } from "../types";
import { useNotificationStore } from "../stores/notificationStore";

const logged = new Set<string>();
function logOnce(operation: string, error: unknown) {
  if (logged.has(operation)) return;
  logged.add(operation);
  console.warn(`Unread badge: ${operation} failed`, error);
}

/** Tauri accepts PNG bytes when its image-png feature is enabled. */
export function createBadgeIcon(total: number): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.fillStyle = "#f23f43";
  context.beginPath();
  context.arc(16, 16, 15, 0, Math.PI * 2);
  context.fill();
  if (total <= 9) {
    context.fillStyle = "#ffffff";
    context.font = "bold 23px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(total), 16, 17);
  }
  const bytes = atob(canvas.toDataURL("image/png").split(",")[1]);
  return Uint8Array.from(bytes, (byte) => byte.charCodeAt(0));
}

export function useOSBadge() {
  const { osTotal } = useUnreadBadge();
  const lastApplied = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!isTauri() || lastApplied.current === osTotal) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const currentWindow = getCurrentWindow();
          if (/Windows/i.test(navigator.userAgent)) {
            await currentWindow.setOverlayIcon(osTotal > 0 ? createBadgeIcon(osTotal) : undefined);
          } else {
            await currentWindow.setBadgeCount(osTotal > 0 ? osTotal : undefined);
          }
          lastApplied.current = osTotal;
        } catch (error) { logOnce("sync", error); }
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [osTotal]);

  useEffect(() => {
    if (!isTauri()) return;
    const onDM = (event: Event) => {
      if (document.hasFocus()) return;
      const message = (event as CustomEvent<Message>).detail;
      const { mutedChannels, mutedDmUsers } = useNotificationStore.getState();
      if (mutedChannels.has(message.channelId) || mutedDmUsers.has(message.author.id)) return;
      void (async () => {
        try {
          await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
        } catch (error) { logOnce("attention", error); }
      })();
    };
    window.addEventListener(DM_MESSAGE_EVENT, onDM);
    return () => window.removeEventListener(DM_MESSAGE_EVENT, onDM);
  }, []);
}
