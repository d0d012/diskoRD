import { useStore } from 'zustand';
import type { SyncAdapter, UserId } from '../contract';
import { getFollowStore } from '../state/followStore';

interface FollowPersonButtonProps { adapter: SyncAdapter; userId: UserId; name: string }
export function FollowPersonButton({ adapter, userId, name }: FollowPersonButtonProps) {
  const store = getFollowStore(adapter);
  const active = useStore(store, state => state.userId === userId);
  return <button type="button" className="wb-people-btn" aria-label={`${active ? 'Stop following' : 'Follow'} ${name}`} aria-pressed={active}
    onClick={() => store.getState().follow(active ? null : userId)}>{active ? 'Unfollow' : 'Follow'}</button>;
}
