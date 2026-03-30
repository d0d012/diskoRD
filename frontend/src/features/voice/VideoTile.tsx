import { useEffect, useRef } from "react";
import { Track } from "livekit-client";

interface VideoTileProps {
  track: Track;
  className?: string;
}

export function VideoTile({ track, className }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || typeof track.attach !== "function") return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className={className}
      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
    />
  );
}
