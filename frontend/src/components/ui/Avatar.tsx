import { PresenceDot } from "./PresenceDot";
import { avatarColor } from "../../lib/avatar";

interface AvatarProps {
  name: string;
  size?: number;
  /** Shows a presence dot when set. */
  status?: string;
  /** Background behind the avatar, used to cut out the presence dot. */
  ringColor?: string;
}

export function Avatar({ name, size = 32, status, ringColor = "var(--color-dc-bg-secondary)" }: AvatarProps) {
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold select-none"
        style={{ backgroundColor: avatarColor(name), fontSize: Math.round(size * 0.42) }}
      >
        {name[0]?.toUpperCase() ?? "?"}
      </div>
      {status && <PresenceDot status={status} size={Math.max(10, Math.round(size * 0.3))} borderColor={ringColor} />}
    </div>
  );
}
