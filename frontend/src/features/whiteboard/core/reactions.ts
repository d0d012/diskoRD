import {
  MAX_REACTION_EMOJI_LENGTH, MAX_STICKY_REACTION_EMOJIS, MAX_STICKY_REACTION_USERS,
} from '../contract';
import type { StickyReactions, UserId } from '../contract';

/**
 * Toggles `userId`'s reaction for `emoji` on a sticky note.
 * Returns the next reactions map, or `null` if adding would exceed a contract cap.
 */
export function toggleStickyReaction(
  current: StickyReactions | undefined,
  emoji: string,
  userId: UserId,
): StickyReactions | null {
  const clean = emoji.trim();
  if (!clean || [...clean].length > MAX_REACTION_EMOJI_LENGTH) return null;
  const base: Record<string, readonly UserId[]> = current ? { ...current } : {};
  const existing = base[clean] ?? [];
  if (existing.includes(userId)) {
    const remaining = existing.filter(id => id !== userId);
    if (remaining.length === 0) delete base[clean];
    else base[clean] = remaining;
    return base;
  }
  if (!(clean in base) && Object.keys(base).length >= MAX_STICKY_REACTION_EMOJIS) return null;
  if (existing.length >= MAX_STICKY_REACTION_USERS) return null;
  base[clean] = [...existing, userId];
  return base;
}
