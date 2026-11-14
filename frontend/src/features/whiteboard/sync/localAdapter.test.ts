import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardObject, Command, Commit, RectObject } from '../contract';
import {
  createLocalAdapter, LOCAL_BOARD_ID, LOCAL_REMOTE_USER_ID, LOCAL_USER_ID,
} from './localAdapter';

function oid(n: number): string {
  return `aaaaaaaa-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}
function opId(n: number): string {
  return `bbbbbbbb-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}
const RANKS = ['1:a0', '1:a1', '1:a2', '1:a3', '1:a4'];

function rect(
  id: string, version = 1, x = 0, rank = RANKS[0], createdBy = LOCAL_USER_ID,
): RectObject {
  return {
    id, version, x, y: 0, w: 100, h: 100, kind: 'rect', rank, createdBy,
    style: { colour: 'ink', weight: 'thin', fill: 'none' },
  };
}

function create(opIdValue: string, id: string, body: BoardObject): Command {
  return { opId: opIdValue, changes: [{ id, action: 'create', expectedVersion: 0, body }] };
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await Promise.resolve();
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createLocalAdapter', () => {
  it('connect and refetch return a rank-ordered, immutable snapshot', async () => {
    const objects = [rect(oid(1), 1, 0, RANKS[0]), rect(oid(2), 1, 5, RANKS[1])];
    const adapter = createLocalAdapter({ snapshot: { seq: 1, objects } });
    const statuses: string[] = [];
    adapter.onStatus(status => statuses.push(status));

    expect(adapter.getStatus()).toBe('offline');
    await expect(adapter.connect()).resolves.toEqual({ seq: 1, objects });
    expect(statuses).toEqual(['connecting', 'live']);
    await expect(adapter.refetch()).resolves.toEqual({ seq: 1, objects });
    expect(statuses).toEqual(['connecting', 'live', 'resyncing', 'live']);
  });

  it('submits a create atomically, bumps seq, sets version=seq and broadcasts asynchronously', async () => {
    const adapter = createLocalAdapter();
    const commits: Commit[] = [];
    adapter.onCommit(commit => commits.push(commit));
    await adapter.connect();

    const result = await adapter.submit(create(opId(1), oid(1), rect(oid(1), 0)));
    expect(result).toEqual({ seq: 1, changes: [{ id: oid(1), action: 'create', version: 1 }] });
    expect(commits).toHaveLength(0); // broadcast is asynchronous, like a gateway fanout

    await flush();
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ channelId: LOCAL_BOARD_ID, opId: opId(1), seq: 1, userId: LOCAL_USER_ID });
    expect((commits[0].changes[0] as { body: BoardObject }).body).toMatchObject({ id: oid(1), version: 1 });

    const snapshot = await adapter.refetch();
    expect(snapshot.seq).toBe(1);
    expect(snapshot.objects).toEqual([rect(oid(1), 1)]);
  });

  it('rejects stale writes with conflict+current and missing objects with gone', async () => {
    const adapter = createLocalAdapter({ snapshot: { seq: 2, objects: [rect(oid(1), 2, 10)] } });
    await adapter.connect();

    const stale = await adapter.submit({
      opId: opId(1), changes: [{ id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 20 } }],
    });
    expect(stale).toEqual({
      opId: opId(1), code: 'conflict', seq: 2, error: 'Board precondition failed', current: [rect(oid(1), 2, 10)],
    });

    const gone = await adapter.submit({
      opId: opId(2), changes: [{ id: oid(9), action: 'delete', expectedVersion: 1 }],
    });
    expect(gone).toMatchObject({ opId: opId(2), code: 'gone', seq: 2, current: [] });
  });

  it('rejects a guarded create whose expectedSeq is stale', async () => {
    const adapter = createLocalAdapter({ snapshot: { seq: 3, objects: [] } });
    await adapter.connect();
    const reject = await adapter.submit({
      opId: opId(1),
      changes: [{ id: oid(1), action: 'create', expectedVersion: 0, expectedSeq: 2, body: rect(oid(1), 0) }],
    });
    expect(reject).toMatchObject({ opId: opId(1), code: 'conflict', seq: 3, current: [] });
  });

  it('is all-or-nothing: no partial write when one change in a command fails', async () => {
    const adapter = createLocalAdapter({ snapshot: { seq: 1, objects: [rect(oid(1), 1, 0)] } });
    await adapter.connect();

    const reject = await adapter.submit({
      opId: opId(1),
      changes: [
        { id: oid(1), action: 'update', expectedVersion: 1, patch: { x: 50 } },
        { id: oid(2), action: 'update', expectedVersion: 1, patch: { x: 60 } },
      ],
    });
    expect(reject).toMatchObject({ code: 'gone', seq: 1 });

    const snapshot = await adapter.refetch();
    expect(snapshot.seq).toBe(1);
    expect(snapshot.objects).toEqual([rect(oid(1), 1, 0)]);
  });

  it('is idempotent per opId: resend returns the same result and broadcasts once', async () => {
    const adapter = createLocalAdapter();
    const commits: Commit[] = [];
    adapter.onCommit(commit => commits.push(commit));
    await adapter.connect();

    const command = create(opId(1), oid(1), rect(oid(1), 0));
    const first = await adapter.submit(command);
    const second = await adapter.submit(command);
    expect(second).toEqual(first);

    await flush();
    expect(commits).toHaveLength(1);
    expect((await adapter.refetch()).seq).toBe(1);
  });

  it('presence methods are no-ops satisfying the interface', () => {
    const adapter = createLocalAdapter();
    adapter.sendPresence({ cursor: { x: 1, y: 2 } });
    expect(adapter.getPresence()).toEqual([]);
    const unsubscribe = adapter.subscribePresence(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('uploadAsset keeps the image in memory and reports its decoded size', async () => {
    class FakeImage {
      naturalWidth = 320; naturalHeight = 200;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', FakeImage);
    const create = vi.fn(() => 'blob:local-1');
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = create;
    try {
      const adapter = createLocalAdapter();
      const asset = await adapter.uploadAsset(new Blob(['x'], { type: 'image/png' }));
      expect(asset).toMatchObject({ url: 'blob:local-1', width: 320, height: 200 });
      expect(asset.id).toMatch(/^[0-9a-f-]{36}$/);
      await expect(adapter.uploadAsset(new Blob(['x'], { type: 'image/svg+xml' }))).rejects.toThrow('not a supported image');
    } finally {
      URL.createObjectURL = originalCreate;
      vi.unstubAllGlobals();
    }
  });

  it('failTransportOnce fails the first submit as transport, then succeeds', async () => {
    const adapter = createLocalAdapter({ failTransportOnce: true });
    await adapter.connect();
    const command = create(opId(1), oid(1), rect(oid(1), 0));

    await expect(adapter.submit(command)).rejects.toThrow('Injected local transport failure');
    expect((await adapter.refetch()).seq).toBe(0); // failure was before evaluation

    await expect(adapter.submit(command)).resolves.toMatchObject({ seq: 1 });
    expect((await adapter.refetch()).objects).toEqual([rect(oid(1), 1)]);
  });

  it('latencyMs delays responses', async () => {
    const adapter = createLocalAdapter({ latencyMs: request => request.kind === 'submit' ? 50 : 0 });
    await adapter.connect();

    let settled = false;
    const promise = adapter.submit(create(opId(1), oid(1), rect(oid(1), 0))).then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await flush(49);
    expect(settled).toBe(false);
    await flush(1);
    await promise;
    expect(settled).toBe(true);
  });

  it('commitDelayMs can drop or reorder broadcasts', async () => {
    const adapter = createLocalAdapter({
      commitDelayMs: commit => commit.seq === 2 ? null : commit.seq === 3 ? 50 : 0,
    });
    const commits: Commit[] = [];
    adapter.onCommit(commit => commits.push(commit));
    await adapter.connect();

    await adapter.applyRemote(create(opId(1), oid(1), rect(oid(1), 0, 0, RANKS[0], LOCAL_REMOTE_USER_ID)));
    await adapter.applyRemote(create(opId(2), oid(2), rect(oid(2), 0, 0, RANKS[1], LOCAL_REMOTE_USER_ID)));
    await adapter.applyRemote(create(opId(3), oid(3), rect(oid(3), 0, 0, RANKS[2], LOCAL_REMOTE_USER_ID)));

    await flush(0);
    expect(commits.map(commit => commit.seq)).toEqual([1]); // seq 2 dropped, seq 3 pending
    await flush(50);
    expect(commits.map(commit => commit.seq)).toEqual([1, 3]);
  });

  it('applyRemote stamps the remote user and applies as another member', async () => {
    const adapter = createLocalAdapter();
    const commits: Commit[] = [];
    adapter.onCommit(commit => commits.push(commit));
    await adapter.connect();

    const result = await adapter.applyRemote(create(opId(1), oid(1), rect(oid(1), 0, 0, RANKS[0], LOCAL_REMOTE_USER_ID)));
    expect(result).toMatchObject({ seq: 1 });
    await flush();
    expect(commits[0]).toMatchObject({ userId: LOCAL_REMOTE_USER_ID, seq: 1 });
  });

  it('responseDelayMs null drops the HTTP response after committing', async () => {
    const adapter = createLocalAdapter({ responseDelayMs: () => null });
    await adapter.connect();

    let settled: 'pending' | 'fulfilled' | 'rejected' = 'pending';
    void adapter.submit(create(opId(1), oid(1), rect(oid(1), 0))).then(
      () => { settled = 'fulfilled'; },
      () => { settled = 'rejected'; },
    );
    await flush(5000);
    expect(settled).toBe('pending');
    expect((await adapter.refetch()).seq).toBe(1); // the server committed anyway

    adapter.dispose(); // dispose aborts the stuck request
    await flush(0);
    expect(settled).toBe('rejected');
  });
});
