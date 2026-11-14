import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RectObject } from '../contract';
import { createBoardStore } from '../state';
import { createSyncCoordinator } from './coordinator';
import type { SyncNotice } from './coordinator';
import {
  createLocalAdapter, LOCAL_BOARD_ID, LOCAL_REMOTE_USER_ID, LOCAL_USER_ID,
} from './localAdapter';
import type { LocalAdapter, LocalAdapterOptions } from './localAdapter';

function oid(n: number): string {
  return `aaaaaaaa-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}
function localOpId(n: number): string {
  return `bbbbbbbb-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}
function remoteOpId(n: number): string {
  return `cccccccc-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}
const RANKS = ['1:a0', '1:a1', '1:a2', '1:a3'];

function rect(id: string, version = 1, x = 0, rank = RANKS[0]): RectObject {
  return {
    id, version, x, y: 0, w: 100, h: 100, kind: 'rect', rank, createdBy: LOCAL_REMOTE_USER_ID,
    style: { colour: 'ink', weight: 'thin', fill: 'none' },
  };
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
  await Promise.resolve();
}

interface Harness {
  store: ReturnType<typeof createBoardStore>;
  adapter: LocalAdapter;
  coordinator: ReturnType<typeof createSyncCoordinator>;
  notices: SyncNotice[];
}

function harness(
  options: LocalAdapterOptions = {},
  objects: RectObject[] = [rect(oid(1), 1, 0)],
  seq = 1,
): Harness {
  const adapter = createLocalAdapter({ snapshot: { seq, objects }, ...options });
  let counter = 0;
  const store = createBoardStore({
    boardId: LOCAL_BOARD_ID, userId: LOCAL_USER_ID, createOpId: () => localOpId(++counter),
  });
  const notices: SyncNotice[] = [];
  const coordinator = createSyncCoordinator({ store, adapter, onNotice: notice => notices.push(notice) });
  return { store, adapter, coordinator, notices };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createSyncCoordinator', () => {
  it('connects, hydrates, and applies an acknowledged local write', async () => {
    const { store, coordinator } = harness();
    await coordinator.start();
    expect(store.getSeq()).toBe(1);
    expect(store.getObject(oid(1))).toMatchObject({ x: 0, version: 1 });

    store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 10 } }]);
    await flush();
    expect(store.getObject(oid(1))).toMatchObject({ x: 10, version: 2 });
    expect(store.getSeq()).toBe(2);
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getGap()).toBeNull();
  });

  it('applies a conflict reject to adopt the server state', async () => {
    const { store, adapter, coordinator } = harness(
      { latencyMs: request => request.kind === 'submit' ? 50 : 0 },
      [rect(oid(1), 1, 0)], 1,
    );
    await coordinator.start();
    store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 10 } }]);
    await adapter.applyRemote({
      opId: remoteOpId(1), changes: [{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 99 } }],
    });
    await flush(0); // deliver the remote commit before the slow submit resolves
    await flush(50); // the stale local submit now resolves -> reject
    await flush(0);

    expect(store.getObject(oid(1))).toMatchObject({ x: 99, version: 2 });
    expect(store.getSeq()).toBe(2);
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getGap()).toBeNull();
    expect(store.canUndo()).toBe(false);
  });

  it('resends once after the ack timeout and applies the idempotent result once', async () => {
    const { store, coordinator } = harness(
      { commitDelayMs: () => null, responseDelayMs: (_command, attempt) => attempt === 1 ? null : 0 },
      [rect(oid(1), 1, 0)], 1,
    );
    await coordinator.start();
    store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 10 } }]);
    await flush(0);
    expect(store.getPendingOperations()[0]).toMatchObject({ attempts: 1, status: 'sending' });
    expect(store.getSeq()).toBe(1);

    await flush(5000); // ack timeout -> single resend
    await flush(0);
    expect(store.getObject(oid(1))).toMatchObject({ x: 10, version: 2 });
    expect(store.getSeq()).toBe(2);
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getGap()).toBeNull();
  });

  it('refetches and abandons an unknown outcome after two timeouts', async () => {
    const { store, coordinator, notices } = harness(
      { commitDelayMs: () => null, responseDelayMs: () => null },
      [rect(oid(1), 1, 0)], 1,
    );
    await coordinator.start();
    const op = store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 10 } }]);
    await flush(0);

    await flush(5000); // first timeout -> resend
    expect(store.getPendingOperations()[0]).toMatchObject({ attempts: 2, status: 'retrying' });
    await flush(5000); // second timeout -> refetch + abandon
    await flush(0);

    expect(store.getSeq()).toBe(2); // adopted via refetch, never via a dropped ack
    expect(store.getObject(oid(1))).toMatchObject({ x: 10, version: 2 });
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getGap()).toBeNull();
    expect(notices.some(notice => notice.type === 'outcome-unknown' && notice.opId === op)).toBe(true);
  });

  it('resolves an out-of-order commit within the 300 ms hold window without refetching', async () => {
    const statuses: string[] = [];
    const { store, adapter, coordinator } = harness(
      { commitDelayMs: commit => commit.seq === 2 ? 200 : 0 },
      [rect(oid(1), 1, 0)], 1,
    );
    adapter.onStatus(status => statuses.push(status));
    await coordinator.start();
    statuses.length = 0; // ignore connect/ready transitions

    await adapter.applyRemote({
      opId: remoteOpId(1), changes: [{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 5 } }],
    });
    await adapter.applyRemote({
      opId: remoteOpId(2), changes: [{ id: oid(1), action: 'update', expectedVersion: 2, patch: { x: 6 } }],
    });
    await flush(0);
    expect(store.getGap()).toEqual({ expectedSeq: 2, receivedSeq: 3 });
    expect(store.getSeq()).toBe(1);

    await flush(200); // the missing seq 2 arrives within the hold window
    expect(store.getGap()).toBeNull();
    expect(store.getSeq()).toBe(3);
    expect(store.getObject(oid(1))).toMatchObject({ x: 6, version: 3 });

    await flush(300); // past the original hold deadline: no refetch fired
    expect(statuses).not.toContain('resyncing');
  });

  it('refetches a real gap and preserves an in-flight pending op', async () => {
    const { store, adapter, coordinator } = harness(
      { commitDelayMs: commit => commit.seq === 2 ? null : 0, responseDelayMs: (_command, attempt) => attempt === 1 ? null : 0 },
      [rect(oid(1), 1, 0)], 1,
    );
    await coordinator.start();
    const op = store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 10 } }]);
    await flush(0);
    expect(store.getPendingOperations()[0]).toMatchObject({ attempts: 1 });

    // A remote commit at seq 3 lands while our own seq 2 is missing (dropped).
    await adapter.applyRemote({
      opId: remoteOpId(1), changes: [{ id: oid(1), action: 'update', expectedVersion: 2, patch: { x: 99 } }],
    });
    await flush(0);
    expect(store.getGap()).toEqual({ expectedSeq: 2, receivedSeq: 3 });

    await flush(300); // gap hold expires -> refetch
    await flush(0);
    expect(store.getSeq()).toBe(3);
    expect(store.getGap()).toBeNull();
    expect(store.getObject(oid(1))).toMatchObject({ x: 99, version: 3 });
    expect(store.getPendingOperations().map(operation => operation.command.opId)).toContain(op);
  });

  it('converges when a remote change to another object arrives mid-flight', async () => {
    const { store, adapter, coordinator } = harness(
      { latencyMs: request => request.kind === 'submit' ? 50 : 0 },
      [rect(oid(1), 1, 0, RANKS[0]), rect(oid(2), 1, 0, RANKS[1])], 1,
    );
    await coordinator.start();
    store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 10 } }]);
    await adapter.applyRemote({
      opId: remoteOpId(1), changes: [{ id: oid(2), action: 'update', expectedVersion: 1, patch: { x: 50 } }],
    });
    await flush(0); // remote commit for b lands while a's submit is in flight
    await flush(50); // a's submit resolves at the next seq
    await flush(0);

    expect(store.getObject(oid(1))).toMatchObject({ x: 10, version: 3 });
    expect(store.getObject(oid(2))).toMatchObject({ x: 50, version: 2 });
    expect(store.getSeq()).toBe(3);
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getGap()).toBeNull();
  });

  it('re-hydrates when the adapter emits a recovery snapshot', async () => {
    const { store, adapter, coordinator } = harness({ commitDelayMs: () => null }, [rect(oid(1), 1, 0)], 1);
    await coordinator.start();

    await adapter.applyRemote({
      opId: remoteOpId(1), changes: [{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 99 } }],
    });
    expect(store.getSeq()).toBe(1);
    expect(store.getObject(oid(1))).toMatchObject({ x: 0 });

    await adapter.simulateReconnect();
    await flush(0);
    expect(store.getSeq()).toBe(2);
    expect(store.getObject(oid(1))).toMatchObject({ x: 99, version: 2 });
  });

  it('disposes cleanly while a submit is in flight', async () => {
    const { store, adapter, coordinator } = harness(
      { latencyMs: request => request.kind === 'submit' ? 100 : 0 },
      [rect(oid(1), 1, 0)], 1,
    );
    await coordinator.start();
    store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 10 } }]);
    await flush(0);
    expect(store.getPendingOperations()[0]).toMatchObject({ attempts: 1, status: 'sending' });

    coordinator.dispose();
    expect(adapter.getStatus()).toBe('offline');
    await flush(100); // the in-flight request is aborted, not applied

    expect(store.getSeq()).toBe(1);
    expect(store.getObject(oid(1))).toMatchObject({ x: 10, version: 1 }); // optimistic only
    await expect(coordinator.start()).rejects.toThrow();
  });
});
