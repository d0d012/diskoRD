import { useLayoutEffect, useRef } from 'react';
import type { BoardStore, Runtime, SyncAdapter, UserId } from '../../contract';
import { createPresencePainter } from './presencePainter';
import { participantStyle, useRoomParticipants } from './presence';

export interface PresenceLayerProps {
  adapter: SyncAdapter;
  runtime: Runtime;
  store: BoardStore;
  selfUserId: UserId;
}

/** Screen-space child of Viewport. React owns membership, not samples. */
export function PresenceLayer({ adapter, runtime, store, selfUserId }: PresenceLayerProps) {
  const members = useRoomParticipants(adapter);
  const root = useRef<HTMLDivElement>(null);
  const painter = useRef<ReturnType<typeof createPresencePainter> | null>(null);
  useLayoutEffect(() => {
    if (!root.current) return;
    const next = createPresencePainter(root.current, adapter, runtime, store, selfUserId);
    painter.current = next;
    return () => { next.dispose(); painter.current = null; };
  }, [adapter, runtime, store, selfUserId]);
  useLayoutEffect(() => { painter.current?.schedule(); }, [members]);
  return <div ref={root} className="wb-presence-layer" aria-hidden="true">
    {members.filter(p => p.userId !== selfUserId).map(p => <div key={p.userId} data-wb-presence-user={p.userId} style={participantStyle(p.colourIndex)}>
      <div data-wb-remote-ghosts="" />
      <div data-wb-remote-selections="" />
      <div className="wb-presence-laser-wrap" data-wb-remote-laser="" hidden>
        <svg className="wb-presence-laser" aria-hidden="true"><path data-wb-remote-laser-path="" /></svg>
      </div>
      <div className="wb-root__cursor" data-wb-remote-cursor="" hidden>
        <svg viewBox="0 0 20 20" shapeRendering="crispEdges" aria-hidden="true">
          <path fill="var(--wb-cursor-color)" d="M1 1H3V3H5V5H7V7H9V9H11V11H13V13H9V15H11V19H7V15H5V13H3V15H1Z" />
        </svg>
        <span className="wb-root__cursor-pill">{p.name}<span className="wb-root__cursor-status" data-wb-cursor-status="" /></span>
      </div>
    </div>)}
  </div>;
}
