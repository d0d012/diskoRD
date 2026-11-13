import { useEffect, useRef } from "react";
import { statusLabel } from "../../lib/avatar";

type DotStatus = "online" | "idle" | "dnd" | "offline";

interface Props {
  status: DotStatus | string;
  size?: number;
  borderColor?: string;
}

/**
 * Presence indicator with a distinct shape per status so it stays readable for
 * color-blind users: filled circle (online), crescent (idle), barred circle
 * (dnd), hollow ring (offline).
 */
export function PresenceDot({ status, size = 10, borderColor = "var(--color-dc-bg-secondary)" }: Props) {
  const normalized: DotStatus =
    status === "online" || status === "idle" || status === "dnd" ? status : "offline";
  const previousStatus = useRef(normalized);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (previousStatus.current !== normalized) {
      svgRef.current?.classList.add("dc-presence-in");
    }
    previousStatus.current = normalized;
  }, [normalized]);

  const color =
    normalized === "online" ? "var(--color-dc-online)"
    : normalized === "idle" ? "var(--color-dc-idle)"
    : normalized === "dnd" ? "var(--color-dc-dnd)"
    : "var(--color-dc-offline)";

  return (
    <div
      className="absolute rounded-full flex items-center justify-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        padding: 2,
        backgroundColor: borderColor,
        bottom: -1,
        right: -1,
      }}
      title={statusLabel(normalized)}
    >
      <svg ref={svgRef} key={normalized} className="block h-full w-full" viewBox="0 0 16 16" aria-hidden="true">
        {normalized === "idle" ? (
          <path d="M15.3 9.3A7.6 7.6 0 0 1 6.7.7 7.6 7.6 0 1 0 15.3 9.3Z" fill={color} />
        ) : normalized === "offline" ? (
          <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="3" />
        ) : (
          <>
            <circle cx="8" cy="8" r="8" fill={color} />
            {normalized === "dnd" && <rect x="3" y="6.5" width="10" height="3" rx="1.5" fill={borderColor} />}
          </>
        )}
      </svg>
    </div>
  );
}
