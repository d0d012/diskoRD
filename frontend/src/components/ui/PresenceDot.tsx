import type { CSSProperties } from "react";
import { statusLabel } from "../../lib/avatar";

type DotStatus = "online" | "idle" | "dnd" | "offline";

interface Props {
  status: DotStatus | string;
  size?: number;
  borderColor?: string;
}

/**
 * Presence indicator with a distinct shape per status so it stays readable for
 * color-blind users: filled circle (online), crescent (idle), solid red circle
 * (dnd), hollow ring (offline).
 */
export function PresenceDot({ status, size = 10, borderColor = "var(--color-dc-bg-secondary)" }: Props) {
  const normalized: DotStatus =
    status === "online" || status === "idle" || status === "dnd" ? status : "offline";

  const color =
    normalized === "online" ? "var(--color-dc-online, #23a55a)"
    : normalized === "idle" ? "var(--color-dc-idle, #f0b232)"
    : normalized === "dnd" ? "var(--color-dc-dnd, #ed4245)"
    : "var(--color-dc-offline, var(--color-dc-text-muted))";

  const crescentMask = "radial-gradient(circle at 26% 26%, transparent 0 44%, #000 46%)";

  const innerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    position: "relative",
  };

  return (
    <div
      className="absolute rounded-full border-2 flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        borderColor,
        backgroundColor: borderColor,
        bottom: -1,
        right: -1,
      }}
      title={statusLabel(normalized)}
    >
      {normalized === "offline" ? (
        <span
          className="rounded-full"
          style={{ ...innerStyle, border: `${Math.max(1, Math.round(size * 0.16))}px solid ${color}` }}
        />
      ) : (
        <span
          className="rounded-full"
          style={{
            ...innerStyle,
            backgroundColor: color,
            ...(normalized === "idle"
              ? { maskImage: crescentMask, WebkitMaskImage: crescentMask }
              : {}),
          }}
        />
      )}
    </div>
  );
}
