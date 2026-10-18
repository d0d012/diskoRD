import { ICON, type IconName } from "./iconPaths";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="flex-shrink-0">
      <path d={ICON[name]} />
    </svg>
  );
}
