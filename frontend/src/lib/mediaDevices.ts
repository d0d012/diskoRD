import { useSettingsStore } from "../stores/settingsStore";
import { isTauri } from "./inviteLinks";
import { openExternal } from "./externalLinks";

/** getUserMedia constraints for the user's chosen microphone (falls back to the default). */
export function micConstraints(): MediaStreamConstraints {
  const id = useSettingsStore.getState().inputDeviceId;
  return { audio: id ? { deviceId: { ideal: id } } : true };
}

export function cameraDeviceId(): string | undefined {
  return useSettingsStore.getState().videoDeviceId || undefined;
}

/** Output selection needs HTMLMediaElement.setSinkId (Chromium; not WebKit/Safari). */
export function supportsOutputSelection(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/** Routes an audio element to the chosen speaker; a no-op where unsupported. */
export function applyOutputDevice(el: HTMLMediaElement, deviceId = useSettingsStore.getState().outputDeviceId): void {
  if (!supportsOutputSelection()) return;
  (el as HTMLMediaElement & { setSinkId(id: string): Promise<void> }).setSinkId(deviceId).catch(() => {});
}

export type PermissionState = "granted" | "denied" | "prompt" | "unknown";
export type MediaKind = "microphone" | "camera";

export async function queryPermission(kind: MediaKind): Promise<PermissionState> {
  try {
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status.state;
  } catch {
    // WebKit can't query media permissions; labels are only exposed once access was granted.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const type = kind === "microphone" ? "audioinput" : "videoinput";
      return devices.some((d) => d.kind === type && d.label) ? "granted" : "unknown";
    } catch {
      return "unknown";
    }
  }
}

/** Triggers the OS/browser prompt. Resolves to whether access was granted. */
export async function requestPermission(kind: MediaKind): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(kind === "microphone" ? { audio: true } : { video: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

/** Desktop only: opens the OS privacy page where the permission can be changed. */
export function canOpenSystemSettings(): boolean {
  return isTauri() && /Mac|Win/i.test(navigator.userAgent);
}

export function openSystemPrivacySettings(kind: MediaKind): void {
  const mac = /Mac/i.test(navigator.userAgent);
  const url = mac
    ? `x-apple.systempreferences:com.apple.preference.security?${kind === "microphone" ? "Privacy_Microphone" : "Privacy_Camera"}`
    : kind === "microphone" ? "ms-settings:privacy-microphone" : "ms-settings:privacy-webcam";
  openExternal(url);
}
