import { useUserStore } from "../stores/userStore";
import type { PublicUser } from "../types";

/**
 * Resolves the freshest profile data for a user: whatever the user store has
 * learned from USER_UPDATE / fetches, layered over the caller's fallback (which
 * may be stale data embedded in an old message or member list).
 */
export function useLiveUser<T extends { id?: string }>(
  id: string | undefined,
  fallback: T
): T & Partial<PublicUser> {
  const live = useUserStore((s) => (id ? s.users[id] : undefined));
  if (!live) return fallback;
  return { ...fallback, ...live };
}
