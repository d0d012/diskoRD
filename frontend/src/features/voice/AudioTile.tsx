import { useEffect, useRef } from "react";
import { Track } from "livekit-client";
import { useVoiceStore } from "../../stores/voiceStore";

interface AudioTileProps {
  track: Track;
  userId: string;
}

export function AudioTile({ track, userId }: AudioTileProps) {
  const elRef = useRef<HTMLAudioElement | null>(null);
  const volume = useVoiceStore((s) => s.remoteVolumes[userId] ?? 1);
  const isDeafened = useVoiceStore((s) => s.isDeafened);

  // Attach track to audio element once per track
  useEffect(() => {
    if (typeof track.attach !== "function") return;
    const el = document.createElement("audio");
    el.autoplay = true;
    el.volume = isDeafened ? 0 : Math.min(volume, 1);
    elRef.current = el;
    track.attach(el);
    el.play().catch(() => {});
    return () => {
      if (typeof track.detach === "function") track.detach(el);
      elRef.current = null;
    };
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update volume without rewiring
  useEffect(() => {
    if (elRef.current) {
      elRef.current.volume = isDeafened ? 0 : Math.min(volume, 1);
    }
  }, [volume, isDeafened]);

  return null;
}
