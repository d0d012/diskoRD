import { useEffect, useRef } from "react";
import { Track } from "livekit-client";
import { useVoiceStore } from "../../stores/voiceStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { applyOutputDevice } from "../../lib/mediaDevices";

interface AudioTileProps {
  track: Track;
  userId: string;
}

export function AudioTile({ track, userId }: AudioTileProps) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const volume = useVoiceStore((s) => s.remoteVolumes[userId] ?? 1);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const outputDeviceId = useSettingsStore((s) => s.outputDeviceId);

  // Attach track to audio element once per track
  useEffect(() => {
    if (typeof track.attach !== "function") return;
    const el = document.createElement("audio");
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    el.style.display = "none";
    // WebKit (the macOS desktop app) only reliably plays elements that are in the DOM.
    document.body.appendChild(el);
    el.volume = isDeafened ? 0 : Math.min(volume, 1);
    applyOutputDevice(el);
    elRef.current = el;
    track.attach(el);

    // WebKit rejects play() that isn't directly tied to a user gesture, which is
    // the case for remote audio arriving after the call is already connected.
    // Retry on the next click or key press until it succeeds.
    const events = ["pointerdown", "keydown"] as const;
    function removeUnlock() {
      events.forEach((e) => document.removeEventListener(e, unlock, true));
    }
    function unlock() {
      el.play().then(removeUnlock).catch(() => {});
    }
    el.play().catch(() => {
      events.forEach((e) => document.addEventListener(e, unlock, true));
    });

    return () => {
      removeUnlock();
      if (typeof track.detach === "function") track.detach(el);
      el.remove();
      elRef.current = null;
    };
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update volume without rewiring
  useEffect(() => {
    if (elRef.current) {
      elRef.current.volume = isDeafened ? 0 : Math.min(volume, 1);
    }
  }, [volume, isDeafened]);

  // Follow speaker changes from settings mid-call
  useEffect(() => {
    if (elRef.current) applyOutputDevice(elRef.current, outputDeviceId);
  }, [outputDeviceId]);

  return null;
}
