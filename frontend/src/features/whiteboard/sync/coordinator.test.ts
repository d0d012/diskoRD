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

  it('backs off on a 429 command response without triggering the 5 s ack timeout resend or cancelling', async () => {
    const { store, adapter, coordinator, notices } = harness({}, [rect(oid(1), 1, 0)], 1);
    await coordinator.start();
    const realSubmit = adapter.submit.bind(adapter);
    let calls = 0;
    vi.spyOn(adapter, 'submit').mockImplementation(async command => {
      calls++;
      if (calls === 1) {
        throw { response: { status: 429, headers: { 'retry-after': '8' }, data: { error: 'rate limit' } } };
      }
      if (calls === 2) {
        throw { response: { status: 429, headers: {}, data: { error: 'rate limit' } } };
      }
      return realSubmit(command);
    });

    store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 42 } }]);
    await flush(0);
    expect(calls).toBe(1);
    expect(store.getPendingOperations()[0]).toMatchObject({ attempts: 1 });
    expect(notices).toEqual([]);

    // 5 s ack timeout passes during the 8 s Retry-After window: no extra copy is sent.
    await flush(5_000);
    expect(calls).toBe(1);
    expect(store.getPendingOperations()[0]).toMatchObject({ attempts: 1 });

    // Remaining 3 s of the 8 s Retry-After elapses -> second attempt (429 without header -> 1 s default).
    await flush(3_000);
    expect(calls).toBe(2);
    expect(store.getPendingOperations()[0]).toMatchObject({ attempts: 1 });

    await flush(999);
    expect(calls).toBe(2);
    await flush(1);
    expect(calls).toBe(3);
    expect(store.getObject(oid(1))).toMatchObject({ x: 42, version: 2 });
    expect(store.getPendingOperations()).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('does not let a late 429 start another retry while the ack-timeout resend is in flight', async () => {
    const { store, adapter, coordinator, notices } = harness();
    await coordinator.start();
    const realSubmit = adapter.submit.bind(adapter);
    let rejectFirst!: (error: unknown) => void;
    let releaseSecond!: () => void;
    let calls = 0;
    const submitSpy = vi.spyOn(adapter, 'submit').mockImplementation(async command => {
      if (++calls === 1) return new Promise((_, reject) => { rejectFirst = reject; });
      if (calls === 2) await new Promise<void>(resolve => { releaseSecond = resolve; });
      return realSubmit(command);
    });

    store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 42 } }]);
    await flush();
    await flush(5_000); // the one permitted ack-timeout resend
    expect(calls).toBe(2);
    expect(submitSpy.mock.calls[1][0]).toBe(submitSpy.mock.calls[0][0]);

    // The older request's response must not clear the newer request's gate
    // or replace its ack deadline with a rate-limit retry deadline.
    rejectFirst({ response: { status: 429, headers: { 'retry-after': '1' } } });
    await flush();
    await flush(1_000);
    expect(calls).toBe(2);
    expect(store.getPendingOperations()[0]).toMatchObject({ attempts: 2 });

    releaseSecond();
    await flush();
    expect(store.getObject(oid(1))).toMatchObject({ x: 42, version: 2 });
    expect(store.getPendingOperations()).toEqual([]);
    expect(notices).toEqual([]);
    coordinator.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['connect', 'refetch'] as const)('clears the coordinator 429 %s backoff on dispose', async kind => {
    const { adapter, coordinator } = harness();
    if (kind === 'refetch') await coordinator.start();
    const get = vi.spyOn(adapter, kind).mockRejectedValue({ response: { status: 429 } });
    const syncing = kind === 'connect' ? coordinator.start() : coordinator.retryRecovery();
    // start rejects on disposal; recovery handles its own errors.
    const assertion = kind === 'connect'
      ? expect(syncing).rejects.toMatchObject({ name: 'AbortError' })
      : expect(syncing).resolves.toBeUndefined();
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    coordinator.dispose();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    await flush(10_000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('caps a large command 429 Retry-After header at 10 s', async () => {
    const { store, adapter, coordinator } = harness({}, [rect(oid(1), 1, 0)], 1);
    await coordinator.start();
    const realSubmit = adapter.submit.bind(adapter);
    let calls = 0;
    vi.spyOn(adapter, 'submit').mockImplementation(async command => {
      if (++calls === 1) {
        throw { response: { status: 429, headers: { 'retry-after': '120' }, data: { error: 'slow down' } } };
      }
      return realSubmit(command);
    });

    store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 15 } }]);
    await flush(0);
    expect(calls).toBe(1);
    await flush(9_999);
    expect(calls).toBe(1);
    await flush(1);
    expect(calls).toBe(2);
    expect(store.getObject(oid(1))).toMatchObject({ x: 15, version: 2 });
    expect(store.getPendingOperations()).toEqual([]);
  });

  it('cancels a 413 command rejection permanently without retrying', async () => {
    const { store, adapter, coordinator, notices } = harness({}, [rect(oid(1), 1, 0)], 1);
    await coordinator.start();
    const submitSpy = vi.spyOn(adapter, 'submit').mockImplementation(async command => ({
      opId: command.opId, code: 'limit', error: 'Command exceeds 1 MiB', current: [],
    }));

    const op = store.dispatch([{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 77 } }]);
    await flush(0);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(store.getObject(oid(1))).toMatchObject({ x: 0, version: 1 });
    expect(store.getPendingOperations()).toEqual([]);
    expect(notices).toEqual([{
      type: 'rejected',
      opId: op,
      message: 'limit: Command exceeds 1 MiB',
    }]);

    await flush(15_000);
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });

  it('backs off for Retry-After when a recovery snapshot refetch returns 429', async () => {
    const { store, adapter, coordinator, notices } = harness(
      { commitDelayMs: commit => commit.seq === 2 ? null : 0 },
      [rect(oid(1), 1, 0)], 1,
    );
    await coordinator.start();
    const realRefetch = adapter.refetch.bind(adapter);
    let refetchCalls = 0;
    vi.spyOn(adapter, 'refetch').mockImplementation(async () => {
      if (++refetchCalls === 1) {
        throw { response: { status: 429, headers: { 'retry-after': '2' }, data: { error: 'rate limit' } } };
      }
      return realRefetch();
    });

    await adapter.applyRemote({
      opId: remoteOpId(1), changes: [{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 10 } }],
    });
    await adapter.applyRemote({
      opId: remoteOpId(2), changes: [{ id: oid(1), action: 'update', expectedVersion: 2, patch: { x: 20 } }],
    });
    await flush(0);
    expect(store.getGap()).toEqual({ expectedSeq: 2, receivedSeq: 3 });

    await flush(300); // gap hold expires -> refetch #1 -> 429
    expect(refetchCalls).toBe(1);
    expect(notices.some(n => n.type === 'recovery-error')).toBe(false);

    await flush(1_999);
    expect(refetchCalls).toBe(1);
    await flush(1); // Retry-After 2 s elapses -> refetch #2 succeeds
    expect(refetchCalls).toBe(2);
    expect(store.getSeq()).toBe(3);
    expect(store.getGap()).toBeNull();
    expect(store.getObject(oid(1))).toMatchObject({ x: 20, version: 3 });
  });
});
