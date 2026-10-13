import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuthStore } from "../../stores/authStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNoiseCancellation } from "../../hooks/useNoiseCancellation";
import { ProfileSettings } from "./ProfileSettings";
import {
  canOpenSystemSettings,
  micConstraints,
  openSystemPrivacySettings,
  queryPermission,
  requestPermission,
  supportsOutputSelection,
  type MediaKind,
  type PermissionState,
} from "../../lib/mediaDevices";

type Section = "profile" | "voice" | "permissions";

interface Props {
  onClose: () => void;
  initialSection?: Section;
}

export function UserSettingsModal({ onClose, initialSection = "voice" }: Props) {
  const [section, setSection] = useState<Section>(initialSection);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmLogout) setConfirmLogout(false);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, confirmLogout]);

  const navItem = (id: Section, label: string) => (
    <button
      onClick={() => setSection(id)}
      className={`w-full text-left px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
        section === id ? "" : "hover:bg-[var(--color-dc-bg-modifier-hover)]"
      }`}
      style={{
        backgroundColor: section === id ? "var(--color-dc-bg-modifier-selected)" : undefined,
        color: section === id ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-normal)",
      }}
    >
      {label}
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="User Settings"
    >
      <div
        className="w-full max-w-[960px] h-[min(680px,90vh)] flex rounded-lg overflow-hidden shadow-2xl"
        style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
      >
        {/* Nav */}
        <nav className="w-52 flex-shrink-0 p-3 flex flex-col gap-0.5" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
          <p className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-dc-text-muted)" }}>
            My Account
          </p>
          {navItem("profile", "My Profile")}
          <p className="px-2.5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-dc-text-muted)" }}>
            App Settings
          </p>
          {navItem("voice", "Voice & Video")}
          {navItem("permissions", "Permissions")}
          <div className="my-2 h-px" style={{ backgroundColor: "var(--color-dc-bg-modifier-hover)" }} />
          <button
            onClick={() => setConfirmLogout(true)}
            className="w-full text-left px-2.5 py-1.5 rounded text-sm font-medium transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
            style={{ color: "var(--color-dc-red)" }}
          >
            Log Out
          </button>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <h2 className="text-xl font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>
              {section === "profile" ? "My Profile" : section === "voice" ? "Voice & Video" : "Permissions"}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close settings"
              title="Close (Esc)"
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
              style={{ color: "var(--color-dc-interactive-normal)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {section === "profile" ? <ProfileSettings /> : section === "voice" ? <VoiceSettings /> : <PermissionSettings />}
          </div>
        </div>
      </div>

      {confirmLogout && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="w-80 rounded-lg p-5 shadow-xl" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
            <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--color-dc-header-primary)" }}>Log Out</h3>
            <p className="text-sm mb-5" style={{ color: "var(--color-dc-text-muted)" }}>Are you sure you want to log out?</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmLogout(false)} className="px-4 py-2 rounded text-sm hover:underline"
                style={{ color: "var(--color-dc-text-normal)" }}>
                Cancel
              </button>
              <button
                autoFocus
                onClick={() => { onClose(); logout(); }}
                className="px-4 py-2 rounded text-sm font-medium text-white hover:brightness-110"
                style={{ backgroundColor: "var(--color-dc-red)" }}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ── Voice & Video ────────────────────────────────────────────────────────────

function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const refresh = useCallback(() => {
    navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => setDevices([]));
  }, []);
  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refresh);
  }, [refresh]);
  return { devices, refresh };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-dc-header-secondary, var(--color-dc-text-muted))" }}>
      {children}
    </h3>
  );
}

function DeviceSelect({ label, kind, devices, value, onChange, disabled }: {
  label: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const options = devices.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default");
  const missing = value && !options.some((d) => d.deviceId === value);
  return (
    <label className="block flex-1 min-w-0">
      <SectionTitle>{label}</SectionTitle>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-10 px-3 rounded text-sm outline-none disabled:opacity-50"
        style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-text-normal)" }}
      >
        <option value="">Default</option>
        {options.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>
        ))}
        {missing && <option value={value}>Disconnected device</option>}
      </select>
    </label>
  );
}

function VoiceSettings() {
  const { inputDeviceId, outputDeviceId, videoDeviceId, setInputDevice, setOutputDevice, setVideoDevice } = useSettingsStore();
  const { isEnabled: ncEnabled, toggle: toggleNC } = useNoiseCancellation();
  const { devices, refresh } = useDevices();
  const labelsHidden = devices.length > 0 && devices.every((d) => !d.label);
  const outputSupported = supportsOutputSelection();

  return (
    <div className="flex flex-col gap-6">
      {labelsHidden && (
        <div className="rounded p-3 text-sm flex items-center gap-3" style={{ backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" }}>
          <span className="flex-1">Device names are hidden until diskoRD can use your microphone.</span>
          <button
            onClick={() => requestPermission("microphone").then(refresh)}
            className="px-3 py-1.5 rounded text-sm font-medium text-white hover:brightness-110"
            style={{ backgroundColor: "var(--color-dc-brand)" }}
          >
            Allow
          </button>
        </div>
      )}

      <div className="flex gap-4">
        <DeviceSelect label="Input Device" kind="audioinput" devices={devices} value={inputDeviceId} onChange={setInputDevice} />
        <div className="flex-1 min-w-0">
          <DeviceSelect label="Output Device" kind="audiooutput" devices={devices} value={outputDeviceId}
            onChange={setOutputDevice} disabled={!outputSupported} />
          {!outputSupported && (
            <p className="text-xs mt-1.5" style={{ color: "var(--color-dc-text-muted)" }}>
              This app plays through your system output. Change it in your OS sound settings.
            </p>
          )}
        </div>
      </div>

      <MicTest key={inputDeviceId} />

      <label className="flex items-center justify-between gap-4 cursor-pointer">
        <span>
          <span className="block text-sm font-medium" style={{ color: "var(--color-dc-header-primary)" }}>Noise Suppression</span>
          <span className="block text-xs" style={{ color: "var(--color-dc-text-muted)" }}>Filters background noise from your microphone.</span>
        </span>
        <Toggle checked={ncEnabled} onChange={toggleNC} />
      </label>

      <div className="h-px" style={{ backgroundColor: "var(--color-dc-bg-modifier-hover)" }} />

      <DeviceSelect label="Camera" kind="videoinput" devices={devices} value={videoDeviceId} onChange={setVideoDevice} />
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0"
      style={{ backgroundColor: checked ? "var(--color-dc-online)" : "var(--color-dc-interactive-muted)" }}
    >
      <span className="absolute top-1 w-4 h-4 rounded-full bg-white transition-[left]" style={{ left: checked ? 20 : 4 }} />
    </button>
  );
}

/** Shows live input level for the selected microphone; nothing is played back. */
function MicTest() {
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!testing) return;
    const bar = barRef.current;
    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    navigator.mediaDevices.getUserMedia(micConstraints()).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        if (bar) bar.style.width = `${Math.min(100, peak * 160)}%`;
        frame = requestAnimationFrame(tick);
      };
      tick();
    }).catch(() => { setError("Couldn't access this microphone. Check Permissions."); setTesting(false); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      if (bar) bar.style.width = "0%";
    };
  }, [testing]);

  return (
    <div>
      <SectionTitle>Mic Test</SectionTitle>
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setError(""); setTesting((t) => !t); }}
          className="px-4 h-9 rounded text-sm font-medium text-white hover:brightness-110 flex-shrink-0"
          style={{ backgroundColor: testing ? "var(--color-dc-red)" : "var(--color-dc-brand)" }}
        >
          {testing ? "Stop Testing" : "Let's Check"}
        </button>
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}>
          <div ref={barRef} className="h-full rounded-full" style={{ width: "0%", backgroundColor: "var(--color-dc-online)", transition: "width 60ms linear" }} />
        </div>
      </div>
      {error && <p className="text-xs mt-1.5" style={{ color: "var(--color-dc-red)" }}>{error}</p>}
    </div>
  );
}

// ── Permissions ──────────────────────────────────────────────────────────────

const PERMISSIONS: { kind: MediaKind; label: string; why: string }[] = [
  { kind: "microphone", label: "Microphone", why: "Needed to talk in voice channels and calls." },
  { kind: "camera", label: "Camera", why: "Needed to turn on video in voice channels and calls." },
];

function PermissionSettings() {
  const [states, setStates] = useState<Record<MediaKind, PermissionState>>({ microphone: "unknown", camera: "unknown" });
  const [busy, setBusy] = useState<MediaKind | null>(null);
  const systemSettings = canOpenSystemSettings();

  const check = useCallback(async () => {
    const [microphone, camera] = await Promise.all([queryPermission("microphone"), queryPermission("camera")]);
    setStates({ microphone, camera });
  }, []);

  useEffect(() => {
    const recheck = () => { void check(); };
    const initial = setTimeout(recheck, 0);
    // Re-check when the user comes back from System Settings.
    window.addEventListener("focus", recheck);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("focus", recheck);
    };
  }, [check]);

  async function allow(kind: MediaKind) {
    setBusy(kind);
    const granted = await requestPermission(kind);
    setBusy(null);
    await check();
    // A denied prompt can't be re-shown by the app; send the user to the OS page instead.
    if (!granted && systemSettings) openSystemPrivacySettings(kind);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm mb-1" style={{ color: "var(--color-dc-text-muted)" }}>
        {systemSettings
          ? "If access was denied, use Open Settings, turn diskoRD on, then come back here."
          : "If access was denied, allow it from your browser's site settings (the icon next to the address bar)."}
      </p>
      {PERMISSIONS.map(({ kind, label, why }) => {
        const state = states[kind];
        const badge =
          state === "granted" ? { text: "Allowed", color: "var(--color-dc-online)" }
          : state === "denied" ? { text: "Blocked", color: "var(--color-dc-red)" }
          : state === "prompt" ? { text: "Not asked yet", color: "var(--color-dc-idle)" }
          : { text: "Unknown", color: "var(--color-dc-text-muted)" };
        return (
          <div key={kind} className="flex items-center gap-4 rounded-lg p-4" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>{label}</span>
                <span className="text-xs font-medium flex items-center gap-1" style={{ color: badge.color }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: badge.color }} />
                  {badge.text}
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-dc-text-muted)" }}>{why}</p>
            </div>
            {state !== "granted" && state !== "denied" && (
              <button
                onClick={() => allow(kind)}
                disabled={busy === kind}
                className="px-3 py-1.5 rounded text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
                style={{ backgroundColor: "var(--color-dc-brand)" }}
              >
                {busy === kind ? "Waiting…" : "Allow"}
              </button>
            )}
            {systemSettings && (
              <button
                onClick={() => openSystemPrivacySettings(kind)}
                className="px-3 py-1.5 rounded text-sm font-medium transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
                style={{ color: "var(--color-dc-text-normal)", border: "1px solid var(--color-dc-bg-modifier-hover)" }}
              >
                Open Settings
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
