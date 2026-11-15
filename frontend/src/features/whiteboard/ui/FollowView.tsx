import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { Runtime, SyncAdapter } from '../contract';
import { attachFollow } from '../input/follow';
import { getFollowStore } from '../state/followStore';
import { participantStyle, useRoomParticipants } from '../render/overlays/presence';
import './follow.css';

interface FollowViewProps { adapter: SyncAdapter; runtime: Runtime }
export function FollowView({ adapter, runtime }: FollowViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const store = getFollowStore(adapter);
  const userId = useStore(store, state => state.userId);
  const members = useRoomParticipants(adapter);
  const person = members.find(p => p.userId === userId);
  useEffect(() => {
    const element = root.current?.closest<HTMLElement>('[data-wb-viewport]');
    if (element) return attachFollow(element, runtime, adapter);
  }, [adapter, runtime]);
  return <div ref={root} className="wb-follow-border" style={person ? participantStyle(person.colourIndex) : undefined} data-following={person ? '' : undefined}>
    {person && <button type="button" data-wb-ui="" className="wb-follow-pill" onClick={() => store.getState().follow(null)} aria-label={`Stop following ${person.name}`}>
      Following {person.name} · Esc
    </button>}
  </div>;
}
