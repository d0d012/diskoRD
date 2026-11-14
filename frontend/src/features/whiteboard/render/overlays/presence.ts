import { useMemo, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { PALETTE_COLOURS } from '../../contract';
import type { Participant, SyncAdapter } from '../../contract';

/** Room indexes are palette indexes, not the legacy named mockup slots. */
export function participantStyle(colourIndex: number): CSSProperties {
  const colour = PALETTE_COLOURS[((colourIndex % PALETTE_COLOURS.length) + PALETTE_COLOURS.length) % PALETTE_COLOURS.length];
  return { '--wb-cursor-color': `var(--wb-colour-${colour})` } as CSSProperties;
}

function createMembershipSource(adapter: SyncAdapter) {
  let members: readonly Participant[] = [];
  function read(): readonly Participant[] {
    const next = [...adapter.getPresence()].sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
    if (next.length !== members.length || next.some((p, i) => {
      const old = members[i];
      return old.userId !== p.userId || old.name !== p.name || old.colourIndex !== p.colourIndex;
    })) members = next.map(({ userId, name, colourIndex }) => ({ userId, name, colourIndex }));
    return members;
  }
  return {
    read,
    subscribe(listener: () => void) {
      return adapter.subscribePresence(() => {
        const previous = members;
        if (read() !== previous) listener();
      });
    },
  };
}

/** Presence samples never invalidate React's membership snapshot. */
export function useRoomParticipants(adapter: SyncAdapter): readonly Participant[] {
  const source = useMemo(() => createMembershipSource(adapter), [adapter]);
  return useSyncExternalStore(source.subscribe, source.read, source.read);
}
