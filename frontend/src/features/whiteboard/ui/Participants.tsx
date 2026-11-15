import { useStore } from 'zustand';
import type { SyncAdapter, UserId } from '../contract';
import { getFollowStore } from '../state/followStore';
import { participantStyle, useRoomParticipants } from '../render/overlays/presence';

export interface ParticipantsProps { adapter: SyncAdapter; selfUserId: UserId }

export function Participants({ adapter, selfUserId }: ParticipantsProps) {
  const members = useRoomParticipants(adapter);
  const followStore = getFollowStore(adapter);
  const following = useStore(followStore, state => state.userId);
  const ordered = [...members.filter(p => p.userId === selfUserId), ...members.filter(p => p.userId !== selfUserId)];
  const overflow = ordered.slice(5);
  return <div className="wb-presence-participants" data-wb-ui="" role="group" aria-label="People on this board">
    {ordered.slice(0, 5).map(p => <button type="button" key={p.userId} className="wb-presence-avatar" style={participantStyle(p.colourIndex)}
      title={`${p.name}${p.userId === selfUserId ? ' (you)' : ''}`} aria-label={`${p.name}${p.userId === selfUserId ? ' (you)' : ''}`}
      disabled={p.userId === selfUserId} aria-pressed={following === p.userId}
      onClick={() => followStore.getState().follow(following === p.userId ? null : p.userId)}>
      {Array.from(p.name.trim())[0]?.toLocaleUpperCase() || '?'}
    </button>)}
    {overflow.length > 0 && <span className="wb-presence-overflow" title={overflow.map(p => p.name).join(', ')}
      aria-label={`${overflow.length} more: ${overflow.map(p => p.name).join(', ')}`} tabIndex={0}>+{overflow.length}</span>}
  </div>;
}
