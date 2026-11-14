import { vi } from 'vitest';
import type { Commit, PresenceParticipant, SyncAdapter, SyncStatus } from '../../contract';

export function participant(overrides: Partial<PresenceParticipant> = {}): PresenceParticipant {
  return {
    userId: 'remote', name: 'Ada', colourIndex: 2, cursor: { x: 20, y: 30 },
    selectedIds: [], editingId: null, drag: null, viewport: null, lastSeenAt: Date.now(), ...overrides,
  };
}

export function fakePresenceAdapter(initial: readonly PresenceParticipant[] = []) {
  let participants = initial;
  let status: SyncStatus = 'live';
  const presenceListeners = new Set<(p: readonly PresenceParticipant[]) => void>();
  const statusListeners = new Set<(s: SyncStatus) => void>();
  const commitListeners = new Set<(c: Commit) => void>();
  const adapter: SyncAdapter = {
    connect: vi.fn(async () => ({ seq: 0, objects: [] })),
    refetch: vi.fn(async () => ({ seq: 0, objects: [] })),
    dispose: vi.fn(), submit: vi.fn(), uploadAsset: vi.fn(), sendPresence: vi.fn(),
    getStatus: () => status,
    onStatus(listener) { statusListeners.add(listener); return () => { statusListeners.delete(listener); }; },
    onCommit(listener) { commitListeners.add(listener); return () => { commitListeners.delete(listener); }; },
    onSnapshot: () => () => undefined,
    getPresence: () => participants,
    subscribePresence(listener) { presenceListeners.add(listener); return () => { presenceListeners.delete(listener); }; },
  };
  return {
    adapter,
    emit(next: readonly PresenceParticipant[]) {
      participants = next;
      presenceListeners.forEach(listener => listener(next));
    },
    commit(commit: Commit) { commitListeners.forEach(listener => listener(commit)); },
    status(next: SyncStatus) { status = next; statusListeners.forEach(listener => listener(status)); },
    listenerCount: () => presenceListeners.size + statusListeners.size + commitListeners.size,
  };
}
