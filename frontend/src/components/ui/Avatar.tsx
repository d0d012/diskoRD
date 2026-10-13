import { useState } from "react";
import { PresenceDot } from "./PresenceDot";
import { avatarColor } from "../../lib/avatar";
import { resolveMediaUrl } from "../../lib/api";
import type { PresenceStatus } from "../../types";

interface AvatarProps {
  name: string;
  /** Profile picture URL; falls back to the colored initial when missing or broken. */
  src?: string | null;
  size?: number;
  /** Shows a presence dot when set. */
  status?: PresenceStatus | string;
  /** Background behind the avatar, used to cut out the presence dot. */
  ringColor?: string;
}

export function Avatar({ name, src, size = 32, status, ringColor = "var(--color-dc-bg-secondary)" }: AvatarProps) {
  const resolved = resolveMediaUrl(src);
  // A new URL means a fresh attempt; a broken old image must not stick.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);

  const showImage = !!resolved && brokenSrc !== resolved;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {showImage ? (
        <img
          src={resolved}
          alt=""
          draggable={false}
          onError={() => setBrokenSrc(resolved ?? null)}
          className="w-full h-full rounded-full object-cover select-none"
        />
      ) : (
        <div
          className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold select-none"
          style={{ backgroundColor: avatarColor(name), fontSize: Math.round(size * 0.42) }}
        >
          {name[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      {status && <PresenceDot status={status} size={Math.max(10, Math.round(size * 0.3))} borderColor={ringColor} />}
    </div>
  );
}
