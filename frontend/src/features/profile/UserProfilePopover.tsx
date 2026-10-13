import { UserProfileCard } from "./UserProfileCard";
import type { Member } from "../../types";

interface Props {
  userId: string;
  guildId?: string | null;
  member?: Member | null;
  canManageRoles?: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  preferredSide?: "left" | "right";
  onClose: () => void;
}

/** Convenience wrapper that opens a {@link UserProfileCard} anchored to an element. */
export function UserProfilePopover({ anchorRef, preferredSide = "left", ...rest }: Props) {
  return <UserProfileCard {...rest} anchorRef={anchorRef} preferredSide={preferredSide} />;
}
