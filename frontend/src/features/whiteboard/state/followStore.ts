import { createStore } from 'zustand/vanilla';
import type { SyncAdapter, UserId } from '../contract';

/** Bound to the adapter lifetime; never shared with the server or another board. */
export function createFollowStore() {
  return createStore<{ userId: UserId | null; follow: (id: UserId | null) => void }>(set => ({
    userId: null,
    follow: userId => set({ userId }),
  }));
}
const stores = new WeakMap<SyncAdapter, ReturnType<typeof createFollowStore>>();
export function getFollowStore(adapter: SyncAdapter) {
  let store = stores.get(adapter);
  if (!store) { store = createFollowStore(); stores.set(adapter, store); }
  return store;
}
