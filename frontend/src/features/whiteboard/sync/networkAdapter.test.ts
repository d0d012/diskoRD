import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, Commit, PresenceParticipant, Snapshot, SyncAdapter, SyncStatus } from '../contract';
import { MAX_PRESENCE_BYTES } from '../contract';
import { createNetworkAdapter } from './networkAdapter';

type Listener = (d: unknown) => void;
const gw = vi.hoisted(() => ({
  open: true,
  sent: [] as { op: string; d: unknown }[],
  events: new Map<string, Set<(d: unknown) => void>>(),
  ready: new Set<() => void>(),
  close: new Set<() => void>(),
}));

vi.mock('../../../hooks/useGateway', () => ({
  sendGateway: (op: string, d: unknown) => {
    if (!gw.open) return false;
    gw.sent.push({ op, d });
    return true;
  },
  onGatewayReady: (l: () => void) => { gw.ready.add(l); return () => { gw.ready.delete(l); }; },
  onGatewayClose: (l: () => void) => { gw.close.add(l); return () => { gw.close.delete(l); }; },
  onGatewayEvent: (op: string, l: Listener) => {
    let set = gw.events.get(op);
    if (!set) gw.events.set(op, set = new Set());
    set.add(l);
    return () => { set.delete(l); };
  },
}));

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../lib/api', () => ({ api: apiMock }));

const BOARD = 'board-1';
const ME = 'user-me';
const BOB = 'user-bob';
const OPID = 'op-1';

function emit(op: string, d: unknown): void {
  for (const listener of [...(gw.events.get(op) ?? [])]) listener(d);
}
function gatewayReady(): void { for (const l of [...gw.ready]) l(); }
function gatewayClose(): void { for (const l of [...gw.close]) l(); }
function sentOps(op: string): { op: string; d: unknown }[] { return gw.sent.filter(m => m.op === op); }
async function tick(ms = 0): Promise<void> { await vi.advanceTimersByTimeAsync(ms); }
function subscribed(participants: unknown[] = [{ userId: ME, name: 'Me', colourIndex: 0 }]): void {
  emit('BOARD_SUBSCRIBED', { channelId: BOARD, seq: 0, participants });
}
function commit(seq: number, channelId = BOARD): Commit {
  return { channelId, opId: `op-${seq}`, seq, userId: BOB, changes: [{ id: `o${seq}`, action: 'delete', version: seq }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const command: Command = { opId: OPID, changes: [{ id: 'a', action: 'delete', expectedVersion: 3 }] };

let adapter: SyncAdapter;
function make(resolveName?: (id: string) => string | undefined): SyncAdapter {
  return createNetworkAdapter({ boardId: BOARD, userId: ME, resolveName });
}
/** Bring an adapter live against an empty board. */
async function goLive(snapshot: Snapshot = { seq: 0, objects: [] }): Promise<void> {
  apiMock.get.mockResolvedValue({ data: { data: snapshot } });
  const connecting = adapter.connect();
  subscribed();
  await connecting;
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  gw.open = true;
  gw.sent.length = 0;
  gw.events.clear(); gw.ready.clear(); gw.close.clear();
  apiMock.get.mockReset(); apiMock.post.mockReset();
  adapter = make();
});
afterEach(() => {
  adapter.dispose();
  vi.useRealTimers();
});

describe('connect', () => {
  it('subscribes, waits for BOARD_SUBSCRIBED, buffers commits during the GET, then delivers newer ones', async () => {
    const statuses: SyncStatus[] = [];
    const commits: number[] = [];
    adapter.onStatus(s => statuses.push(s));
    adapter.onCommit(c => commits.push(c.seq));
    const get = deferred<unknown>();
    apiMock.get.mockReturnValue(get.promise);

    const connecting = adapter.connect();
    expect(sentOps('BOARD_SUBSCRIBE')).toEqual([{ op: 'BOARD_SUBSCRIBE', d: { channelId: BOARD } }]);
    await tick();
    expect(apiMock.get).not.toHaveBeenCalled(); // not before SUBSCRIBED
    expect(adapter.getStatus()).toBe('connecting');

    subscribed();
    await tick();
    expect(apiMock.get).toHaveBeenCalledWith(`/channels/${BOARD}/board`, expect.objectContaining({ signal: expect.anything() }));
    emit('BOARD_COMMIT', commit(4));
    emit('BOARD_COMMIT', commit(5));
    emit('BOARD_COMMIT', commit(6));
    emit('BOARD_COMMIT', commit(7, 'other-board'));
    expect(commits).toEqual([]);

    get.resolve({ data: { data: { seq: 5, objects: [] } } });
    await expect(connecting).resolves.toEqual({ seq: 5, objects: [] });
    expect(adapter.getStatus()).toBe('live');
    expect(commits).toEqual([]); // delivered in the NEXT task, after the caller hydrates
    await tick();
    expect(commits).toEqual([6]);
    emit('BOARD_COMMIT', commit(7));
    expect(commits).toEqual([6, 7]);
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('times out when an old backend ignores BOARD_SUBSCRIBE: offline with a clear error', async () => {
    const connecting = adapter.connect();
    const assertion = expect(connecting).rejects.toThrow(/did not answer/);
    await tick(5_000);
    await assertion;
    expect(adapter.getStatus()).toBe('offline');
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('waits for READY when the socket is not open yet, then subscribes', async () => {
    gw.open = false;
    apiMock.get.mockResolvedValue({ data: { data: { seq: 0, objects: [] } } });
    const connecting = adapter.connect();
    expect(sentOps('BOARD_SUBSCRIBE')).toHaveLength(0);
    gw.open = true;
    gatewayReady();
    expect(sentOps('BOARD_SUBSCRIBE')).toHaveLength(1);
    subscribed();
    await expect(connecting).resolves.toBeDefined();
    expect(adapter.getStatus()).toBe('live');
  });

  // Regression: the 5 s timeout ran even when nothing could be sent, so opening
  // a board during a gateway reconnect backoff failed it for good ("could not connect").
  it('does not time out while the socket is still connecting; the timeout starts with the actual send', async () => {
    gw.open = false;
    apiMock.get.mockResolvedValue({ data: { data: { seq: 0, objects: [] } } });
    const connecting = adapter.connect();
    let settled = false;
    connecting.then(() => { settled = true; }, () => { settled = true; });
    await tick(20_000);
    expect(settled).toBe(false);
    expect(adapter.getStatus()).toBe('connecting');
    gw.open = true;
    gatewayReady();
    expect(sentOps('BOARD_SUBSCRIBE')).toHaveLength(1);
    await tick(4_000);
    subscribed();
    await expect(connecting).resolves.toBeDefined();
    expect(adapter.getStatus()).toBe('live');
  });

  it('a failed GET rejects and leaves the adapter offline', async () => {
    apiMock.get.mockRejectedValue(new Error('Network Error'));
    const connecting = adapter.connect();
    const assertion = expect(connecting).rejects.toThrow('Network Error');
    subscribed();
    await assertion;
    expect(adapter.getStatus()).toBe('offline');
  });

  it('a 429 on the snapshot GET backs off for Retry-After, keeps buffering commits, and retries', async () => {
    const commits: number[] = [];
    adapter.onCommit(c => commits.push(c.seq));
    apiMock.get
      .mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '3' }, data: { error: 'rate limit' } } })
      .mockResolvedValueOnce({ data: { data: { seq: 5, objects: [] } } });

    const connecting = adapter.connect();
    subscribed();
    await tick();
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    expect(adapter.getStatus()).toBe('connecting');
    emit('BOARD_COMMIT', commit(5));
    emit('BOARD_COMMIT', commit(6));

    await tick(2_999);
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    await tick(1);
    await expect(connecting).resolves.toEqual({ seq: 5, objects: [] });
    expect(apiMock.get).toHaveBeenCalledTimes(2);
    expect(adapter.getStatus()).toBe('live');
    expect(commits).toEqual([]); // the caller must hydrate before buffered commits drain
    // The GET resolved inside the backoff timer. Fake timers defer its nested
    // zero-delay flush to the next millisecond, unlike the deferred GET above.
    await tick(1);
    expect(commits).toEqual([6]);
  });

  it('rejects a malformed snapshot instead of hydrating garbage', async () => {
    apiMock.get.mockResolvedValue({ data: { data: { seq: 'x' } } });
    const connecting = adapter.connect();
    const assertion = expect(connecting).rejects.toThrow(/Malformed/);
    subscribed();
    await assertion;
  });
});

describe('refetch', () => {
  it('buffers commits during the GET and keeps the status live', async () => {
    await goLive({ seq: 1, objects: [] });
    const commits: number[] = [];
    adapter.onCommit(c => commits.push(c.seq));
    const get = deferred<unknown>();
    apiMock.get.mockReturnValue(get.promise);
    const refetching = adapter.refetch();
    expect(adapter.getStatus()).toBe('resyncing');
    emit('BOARD_COMMIT', commit(2));
    emit('BOARD_COMMIT', commit(3));
    get.resolve({ data: { data: { seq: 2, objects: [] } } });
    await expect(refetching).resolves.toMatchObject({ seq: 2 });
    expect(adapter.getStatus()).toBe('live');
    await tick();
    expect(commits).toEqual([3]);
    expect(sentOps('BOARD_SUBSCRIBE')).toHaveLength(1); // refetch never re-subscribes
  });

  it('defaults to a 1 s backoff when a 429 snapshot GET has no Retry-After header and caps large values at 10 s', async () => {
    await goLive({ seq: 1, objects: [] });
    apiMock.get
      .mockRejectedValueOnce({ response: { status: 429, headers: {}, data: { error: 'slow down' } } })
      .mockRejectedValueOnce({ response: { status: 429, headers: { 'Retry-After': '60' }, data: { error: 'slow down' } } })
      .mockResolvedValueOnce({ data: { data: { seq: 4, objects: [] } } });

    const refetching = adapter.refetch();
    await tick(0);
    expect(apiMock.get).toHaveBeenCalledTimes(2); // 1 from goLive + 1 initial refetch

    await tick(999);
    expect(apiMock.get).toHaveBeenCalledTimes(2);
    await tick(1); // 1 s default elapses -> second refetch attempt (returns 429 with Retry-After: 60)
    expect(apiMock.get).toHaveBeenCalledTimes(3);

    await tick(9_999);
    expect(apiMock.get).toHaveBeenCalledTimes(3);
    await tick(1); // capped 10 s elapses -> third refetch attempt succeeds
    await expect(refetching).resolves.toEqual({ seq: 4, objects: [] });
    expect(apiMock.get).toHaveBeenCalledTimes(4);
    expect(adapter.getStatus()).toBe('live');
  });
});

describe('submit', () => {
  beforeEach(async () => { await goLive(); });

  it('posts the command and returns the CommandResult', async () => {
    const result = { seq: 4, changes: [{ id: 'a', action: 'delete', version: 4 }] };
    apiMock.post.mockResolvedValue({ data: { data: result } });
    await expect(adapter.submit(command)).resolves.toEqual(result);
    expect(apiMock.post).toHaveBeenCalledWith(`/channels/${BOARD}/board/ops`, command, expect.anything());
  });

  it.each(['conflict', 'gone'] as const)('maps 409 %s to a Reject with the opId and current objects', async code => {
    const current = [{ id: 'a', kind: 'rect', version: 7 }];
    apiMock.post.mockRejectedValue({ response: { status: 409, data: { error: 'stale', code, seq: 7, current } } });
    await expect(adapter.submit(command)).resolves.toEqual({ opId: OPID, error: 'stale', code, seq: 7, current });
  });

  it.each([
    [400, 'invalid'], [403, 'forbidden'], [413, 'limit'], [422, 'invalid'],
  ] as const)('maps HTTP %i to a %s Reject without state evidence', async (status, code) => {
    apiMock.post.mockRejectedValue({ response: { status, data: { error: 'nope' } } });
    await expect(adapter.submit(command)).resolves.toEqual({ opId: OPID, code, error: 'nope', current: [] });
  });

  it('falls back to a generic message when the error body has none', async () => {
    apiMock.post.mockRejectedValue({ response: { status: 400, data: {} } });
    await expect(adapter.submit(command)).resolves.toMatchObject({ code: 'invalid', error: expect.stringContaining('400') });
  });

  it.each([
    ['a network error', new Error('Network Error')],
    ['a 429 rate limit', { response: { status: 429, headers: { 'retry-after': '2' }, data: { error: 'rate limit' } } }],
    ['a 500', { response: { status: 500, data: { error: 'boom' } } }],
    ['a 404', { response: { status: 404, data: { error: 'no board' } } }],
    ['a malformed 409', { response: { status: 409, data: { error: 'x' } } }],
  ])('rejects the promise for %s (a transport error, never a Reject)', async (_name, failure) => {
    apiMock.post.mockRejectedValue(failure);
    await expect(adapter.submit(command)).rejects.toBeDefined();
  });

  it('rejects a malformed success body', async () => {
    apiMock.post.mockResolvedValue({ data: { data: { nope: true } } });
    await expect(adapter.submit(command)).rejects.toThrow(/Malformed/);
  });
});

describe('reconnect', () => {
  it('re-subscribes on READY, delivers the snapshot BEFORE buffered commits, then goes live', async () => {
    await goLive({ seq: 1, objects: [] });
    const order: string[] = [];
    adapter.onSnapshot(s => order.push(`snapshot:${s.seq}`));
    adapter.onCommit(c => order.push(`commit:${c.seq}`));
    const statuses: SyncStatus[] = [];
    adapter.onStatus(s => statuses.push(s));

    gatewayClose();
    expect(adapter.getStatus()).toBe('offline');
    gatewayReady();
    expect(sentOps('BOARD_SUBSCRIBE')).toHaveLength(2);
    expect(adapter.getStatus()).toBe('resyncing');

    apiMock.get.mockResolvedValue({ data: { data: { seq: 3, objects: [] } } });
    subscribed();
    await tick();
    emit('BOARD_COMMIT', commit(4)); // after the flush gate opened
    expect(order).toEqual(['snapshot:3', 'commit:4']);
    expect(adapter.getStatus()).toBe('live');
    expect(statuses).toEqual(['offline', 'resyncing', 'live']);
  });

  it('a READY during the snapshot GET (socket replaced) re-subscribes and refetches', async () => {
    await goLive();
    const first = deferred<unknown>();
    apiMock.get.mockReturnValueOnce(first.promise);
    apiMock.get.mockResolvedValue({ data: { data: { seq: 9, objects: [] } } });
    const snapshots: number[] = [];
    adapter.onSnapshot(s => snapshots.push(s.seq));
    gatewayReady();
    subscribed();
    await tick();
    gatewayReady(); // new socket while GET #1 is pending
    first.resolve({ data: { data: { seq: 5, objects: [] } } });
    await tick();
    expect(sentOps('BOARD_SUBSCRIBE')).toHaveLength(3);
    subscribed();
    await tick();
    expect(snapshots).toEqual([9]);
    expect(adapter.getStatus()).toBe('live');
  });

  it('retries a failed recovery until it works', async () => {
    await goLive();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    apiMock.get.mockRejectedValueOnce(new Error('down'));
    apiMock.get.mockResolvedValue({ data: { data: { seq: 2, objects: [] } } });
    gatewayReady();
    subscribed();
    await tick();
    expect(adapter.getStatus()).toBe('offline');
    await tick(5_000);
    subscribed();
    await tick();
    expect(adapter.getStatus()).toBe('live');
    warn.mockRestore();
  });
});

describe('presence: outgoing', () => {
  beforeEach(async () => { await goLive(); gw.sent.length = 0; });
  const presenceMessages = () => sentOps('BOARD_PRESENCE').map(m => m.d as Record<string, unknown>);

  it('sends the first update immediately with the channelId, omitting untouched fields', async () => {
    adapter.sendPresence({ cursor: { x: 1, y: 2 } });
    expect(presenceMessages()).toEqual([{ channelId: BOARD, cursor: { x: 1, y: 2 } }]);
    adapter.sendPresence({ editingId: 'o1' });
    await tick(50); // one frame per 50 ms whatever the fields
    expect(presenceMessages()[1]).toEqual({ channelId: BOARD, editingId: 'o1' });
  });

  it('coalesces cursor samples to the latest at ~20 Hz', async () => {
    adapter.sendPresence({ cursor: { x: 0, y: 0 } });
    for (let i = 1; i <= 5; i++) { await tick(8); adapter.sendPresence({ cursor: { x: i, y: i } }); }
    expect(presenceMessages()).toHaveLength(1);
    await tick(50);
    const messages = presenceMessages();
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ channelId: BOARD, cursor: { x: 5, y: 5 } });
    await tick(500);
    expect(presenceMessages()).toHaveLength(2);
  });

  it('rate limits other fields to ~5 Hz, merging pending fields; the cursor rides along', async () => {
    adapter.sendPresence({ selectedIds: ['a'] });
    adapter.sendPresence({ cursor: { x: 1, y: 1 } }); // shares the frame window: waits 50 ms
    adapter.sendPresence({ selectedIds: ['a', 'b'] });
    adapter.sendPresence({ viewport: { x: 0, y: 0, w: 10, h: 10 } });
    expect(presenceMessages()).toHaveLength(1);
    await tick(50);
    expect(presenceMessages()).toHaveLength(2);
    expect(presenceMessages()[1]).toEqual({ channelId: BOARD, cursor: { x: 1, y: 1 } });
    await tick(150);
    expect(presenceMessages()).toHaveLength(3);
    expect(presenceMessages()[2]).toEqual({
      channelId: BOARD, selectedIds: ['a', 'b'], viewport: { x: 0, y: 0, w: 10, h: 10 },
    });
  });

  // Regression: the gateway allows 20 BOARD_PRESENCE frames/s per connection
  // (token bucket, burst 20) and silently drops the rest. Separate cursor and
  // other-field frames reached 25/s while dragging; a real two-client run lost
  // about half of the selection/drag updates, including the final drag=null.
  it('never exceeds the server frame budget (20/s, burst 20) while the cursor streams and other fields change', async () => {
    const frames: { at: number; d: Record<string, unknown> }[] = [];
    const push = gw.sent.push.bind(gw.sent);
    gw.sent.push = (...items) => {
      for (const item of items) if (item.op === 'BOARD_PRESENCE') frames.push({ at: Date.now(), d: item.d as Record<string, unknown> });
      return push(...items);
    };
    try {
      // Cursor streaming from a ~144 Hz mouse, while other fields change on their
      // own schedule (marquee/shift-click selection, a drag starting, editing).
      for (let t = 0; t < 10_000; t += 7) {
        adapter.sendPresence({ cursor: { x: t, y: t } });
        if (t % 210 === 105) adapter.sendPresence({ selectedIds: [`id-${t}`] });
        if (t >= 5_000) adapter.sendPresence({ drag: { ids: ['a'], dx: t, dy: 0 } });
        await tick(7);
      }
      adapter.sendPresence({ drag: null });
      await tick(500);
    } finally {
      gw.sent.push = push;
    }
    // Replay the frames through the server's bucket (gateway/board_presence.go).
    let tokens = 20;
    let previous: number | undefined;
    let dropped = 0;
    for (const { at } of frames) {
      if (previous !== undefined) tokens = Math.min(20, tokens + ((at - previous) / 1000) * 20);
      previous = at;
      if (tokens < 1) dropped++; else tokens--;
    }
    expect(dropped).toBe(0);
    expect(frames.length).toBeGreaterThan(150); // the cursor still streams at ~15-20 Hz
    expect(frames.filter(f => 'drag' in f.d).length).toBeGreaterThan(20); // drag at ~5 Hz
    expect(frames.filter(f => 'selectedIds' in f.d).length).toBeGreaterThan(40); // every selection change survives
    expect(frames.at(-1)!.d.drag).toBeNull();
  });

  it('sends explicit nulls and empty selections (clears) rather than dropping them', async () => {
    adapter.sendPresence({ cursor: null, drag: null });
    expect(presenceMessages()[0]).toEqual({ channelId: BOARD, cursor: null, drag: null });
    adapter.sendPresence({ selectedIds: [] });
    await tick(200);
    expect(presenceMessages().at(-1)).toEqual({ channelId: BOARD, selectedIds: [] });
  });

  it('keeps the serialized payload (with the stamped userId) within 2 KiB', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    adapter.sendPresence({ selectedIds: ids });
    const [message] = presenceMessages();
    expect(new TextEncoder().encode(JSON.stringify({ ...message, userId: ME })).byteLength).toBeLessThanOrEqual(MAX_PRESENCE_BYTES);
    expect((message.selectedIds as string[]).length).toBeGreaterThan(0);
    expect((message.selectedIds as string[]).length).toBeLessThan(200);
  });

  it('re-announces everything it knows after a re-subscribe, and keeps non-default state alive', async () => {
    adapter.sendPresence({ cursor: { x: 1, y: 1 }, selectedIds: ['a'] });
    gw.sent.length = 0;
    await tick(5_000);
    expect(presenceMessages()).toEqual([{ channelId: BOARD, cursor: { x: 1, y: 1 }, selectedIds: ['a'] }]);
    gatewayClose();
    adapter.sendPresence({ viewport: { x: 0, y: 0, w: 1, h: 1 } });
    expect(presenceMessages()).toHaveLength(1); // nothing is sent into a dead socket
    gatewayReady();
    apiMock.get.mockResolvedValue({ data: { data: { seq: 0, objects: [] } } });
    subscribed();
    await tick(300); // past both rate-limit windows
    // The cursor and the other fields have separate rate-limit windows, so they may be two messages.
    expect(Object.assign({}, ...presenceMessages().slice(-2))).toEqual({
      channelId: BOARD, cursor: { x: 1, y: 1 }, selectedIds: ['a'], viewport: { x: 0, y: 0, w: 1, h: 1 },
    });
  });
});

describe('presence: incoming', () => {
  let named: SyncAdapter;
  let latest: readonly PresenceParticipant[];
  const self = () => named.getPresence().find(p => p.userId === ME);
  const bob = () => named.getPresence().find(p => p.userId === BOB)!;
  beforeEach(async () => {
    adapter.dispose();
    gw.events.clear(); gw.ready.clear(); gw.close.clear();
    named = createNetworkAdapter({ boardId: BOARD, userId: ME, resolveName: id => (id === BOB ? 'Bobby' : undefined) });
    adapter = named;
    latest = [];
    named.subscribePresence(list => { latest = list; });
    apiMock.get.mockResolvedValue({ data: { data: { seq: 0, objects: [] } } });
    const connecting = named.connect();
    subscribed([{ userId: ME, name: 'Me', colourIndex: 0 }, { userId: BOB, name: 'bob', colourIndex: 1 }]);
    await connecting;
  });

  // Regression: self was excluded, so the Participants strip (self first) never showed the local user.
  it('builds the participant list from SUBSCRIBED, including self with default fields, resolving names first', () => {
    expect(named.getPresence().map(p => p.userId)).toEqual([ME, BOB]);
    expect(self()).toMatchObject({
      userId: ME, name: 'Me', colourIndex: 0, cursor: null, selectedIds: [], editingId: null, drag: null, viewport: null,
    });
    expect(bob()).toMatchObject({
      userId: BOB, name: 'Bobby', colourIndex: 1, cursor: null, selectedIds: [], editingId: null, drag: null, viewport: null,
    });
    expect(latest).toBe(named.getPresence());
  });

  it('merges presence fields: omitted = unchanged, null = cleared, [] clears selection', () => {
    emit('BOARD_PRESENCE', { channelId: BOARD, userId: BOB, cursor: { x: 1, y: 2 }, selectedIds: ['a'], editingId: 'a' });
    emit('BOARD_PRESENCE', { channelId: BOARD, userId: BOB, viewport: { x: 0, y: 0, w: 5, h: 5 } });
    expect(bob()).toMatchObject({
      cursor: { x: 1, y: 2 }, selectedIds: ['a'], editingId: 'a', viewport: { x: 0, y: 0, w: 5, h: 5 },
    });
    emit('BOARD_PRESENCE', { channelId: BOARD, userId: BOB, cursor: null, selectedIds: [], editingId: null });
    expect(bob()).toMatchObject({ cursor: null, selectedIds: [], editingId: null, viewport: { x: 0, y: 0, w: 5, h: 5 } });
  });

  it('ignores malformed fields, unknown users, other boards and self echoes', () => {
    emit('BOARD_PRESENCE', { channelId: BOARD, userId: BOB, cursor: { x: 'a', y: 1 }, drag: { ids: 'no', dx: 1, dy: 1 } });
    emit('BOARD_PRESENCE', { channelId: BOARD, userId: 'stranger', cursor: { x: 1, y: 1 } });
    emit('BOARD_PRESENCE', { channelId: 'other', userId: BOB, cursor: { x: 1, y: 1 } });
    emit('BOARD_PRESENCE', { channelId: BOARD, userId: ME, cursor: { x: 1, y: 1 } });
    expect(named.getPresence().map(p => p.userId)).toEqual([ME, BOB]);
    expect(self()!.cursor).toBeNull(); // self never carries (echoed) presence
    expect(bob().cursor).toBeNull();
    expect(bob().drag).toBeNull();
  });

  it('tracks JOIN and LEAVE, notifying listeners directly', () => {
    const lengths: number[] = [];
    named.subscribePresence(list => lengths.push(list.length));
    emit('BOARD_JOIN', { channelId: BOARD, userId: 'carol', name: 'Carol', colourIndex: 2 });
    // The server sends the subscriber its own JOIN right after SUBSCRIBED: no duplicate self.
    emit('BOARD_JOIN', { channelId: BOARD, userId: ME, name: 'Me', colourIndex: 0 });
    expect(named.getPresence().map(p => [p.userId, p.name, p.colourIndex])).toEqual([[ME, 'Me', 0], [BOB, 'Bobby', 1], ['carol', 'Carol', 2]]);
    emit('BOARD_LEAVE', { channelId: BOARD, userId: BOB });
    emit('BOARD_LEAVE', { channelId: BOARD, userId: 'unknown' });
    expect(named.getPresence().map(p => p.userId)).toEqual([ME, 'carol']);
    expect(lengths).toEqual([3, 3, 2]);
  });

  it('expires a participant\'s presence fields after 10 s of silence but keeps them in the room', async () => {
    emit('BOARD_PRESENCE', { channelId: BOARD, userId: BOB, cursor: { x: 1, y: 1 }, selectedIds: ['a'] });
    await tick(9_000);
    emit('BOARD_PRESENCE', { channelId: BOARD, userId: BOB, cursor: { x: 2, y: 2 } });
    await tick(9_000); // 18 s total but only 9 s since the last update
    expect(bob().cursor).toEqual({ x: 2, y: 2 });
    await tick(1_100);
    expect(named.getPresence()).toHaveLength(2);
    expect(bob()).toMatchObject({ userId: BOB, cursor: null, selectedIds: [] });
    expect(latest.find(p => p.userId === BOB)!.cursor).toBeNull();
  });

  it('forgets everyone when the socket closes', () => {
    gatewayClose();
    expect(named.getPresence()).toEqual([]);
  });
});

describe('uploadAsset', () => {
  const asset = { id: 'asset-1', url: '/uploads/boards/a.png', width: 640, height: 480 };
  const failure = (status: number, error?: string) => Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data: error ? { error } : {} },
  });

  it('posts multipart form data (field `file`) to the board assets endpoint and returns the asset', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { data: asset } });
    const blob = new Blob(['x'], { type: 'image/png' });
    await expect(adapter.uploadAsset(blob)).resolves.toEqual(asset);
    const [path, body, config] = apiMock.post.mock.calls.at(-1)!;
    expect(path).toBe(`/channels/${BOARD}/board/assets`);
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
    expect(config.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([[400, 'That is not an image.'], [413, 'Image too large.'], [429, 'Slow down.']])(
    'shows the server text for %i', async (status, text) => {
      apiMock.post.mockRejectedValueOnce(failure(status, text));
      await expect(adapter.uploadAsset(new Blob(['x']))).rejects.toThrow(text);
    });

  it('maps 403, 404, other statuses and network failures to friendly messages', async () => {
    apiMock.post.mockRejectedValueOnce(failure(403, 'forbidden: internal'));
    await expect(adapter.uploadAsset(new Blob(['x']))).rejects.toThrow("You can't add images to this board.");
    apiMock.post.mockRejectedValueOnce(failure(404));
    await expect(adapter.uploadAsset(new Blob(['x']))).rejects.toThrow('no longer available');
    apiMock.post.mockRejectedValueOnce(failure(500, 'pq: connection refused'));
    await expect(adapter.uploadAsset(new Blob(['x']))).rejects.toThrow('The image could not be uploaded. Try again.');
    apiMock.post.mockRejectedValueOnce(new Error('Network Error'));
    await expect(adapter.uploadAsset(new Blob(['x']))).rejects.toThrow(/reach the server/);
  });

  it('rejects a malformed success response', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { data: { id: 'a' } } });
    await expect(adapter.uploadAsset(new Blob(['x']))).rejects.toThrow(/Malformed/);
  });

  it('rejects with an AbortError once disposed', async () => {
    adapter.dispose();
    await expect(adapter.uploadAsset(new Blob(['x']))).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('dispose', () => {
  it('unsubscribes the room and removes every listener and timer; is idempotent', async () => {
    await goLive();
    adapter.sendPresence({ cursor: { x: 1, y: 1 } });
    adapter.sendPresence({ cursor: { x: 2, y: 2 } }); // leaves a rate-limit timer
    emit('BOARD_JOIN', { channelId: BOARD, userId: BOB, name: 'Bob', colourIndex: 1 });
    emit('BOARD_PRESENCE', { channelId: BOARD, userId: BOB, cursor: { x: 1, y: 1 } }); // leaves an expiry timer
    const commits = vi.fn();
    adapter.onCommit(commits);
    gw.sent.length = 0;

    adapter.dispose();
    adapter.dispose();
    expect(sentOps('BOARD_UNSUBSCRIBE')).toEqual([{ op: 'BOARD_UNSUBSCRIBE', d: { channelId: BOARD } }]);
    expect([...gw.events.values()].every(set => set.size === 0)).toBe(true);
    expect(gw.ready.size + gw.close.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    emit('BOARD_COMMIT', commit(1));
    expect(commits).not.toHaveBeenCalled();
    adapter.sendPresence({ cursor: { x: 3, y: 3 } });
    expect(sentOps('BOARD_PRESENCE')).toHaveLength(0);
    expect(adapter.getStatus()).toBe('offline');
    await expect(adapter.connect()).rejects.toThrow();
    await expect(adapter.submit(command)).rejects.toThrow();
  });

  it('aborts in-flight requests and fails a pending connect', async () => {
    let signal: AbortSignal | undefined;
    apiMock.get.mockImplementation((_url: string, config: { signal: AbortSignal }) => {
      signal = config.signal;
      return new Promise(() => undefined);
    });
    const connecting = adapter.connect();
    const assertion = expect(connecting).rejects.toThrow();
    subscribed();
    await tick();
    adapter.dispose();
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['connect', 'refetch'] as const)('disposes during a 429 %s backoff without leaking a timer or retrying', async kind => {
    if (kind === 'refetch') await goLive();
    apiMock.get.mockRejectedValue({ response: { status: 429, headers: { 'retry-after': '3' } } });
    const syncing = adapter[kind]();
    const assertion = expect(syncing).rejects.toMatchObject({ name: 'AbortError' });
    if (kind === 'connect') subscribed();
    await tick();
    const calls = apiMock.get.mock.calls.length;
    expect(vi.getTimerCount()).toBe(1);

    adapter.dispose();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    await tick(10_000);
    expect(apiMock.get).toHaveBeenCalledTimes(calls);
  });

  it('a pending subscribe wait is rejected, not left to time out', async () => {
    const connecting = adapter.connect();
    const assertion = expect(connecting).rejects.toThrow();
    adapter.dispose();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('purge', () => {
  it('posts createdBy and rect to /channels/:id/board/purge and returns deleted count', async () => {
    apiMock.post.mockResolvedValue({ data: { data: { deleted: 12 } } });
    const result = await adapter.purge!({ createdBy: BOB, rect: { x: 10, y: 20, w: 300, h: 400 } });
    expect(result).toEqual({ deleted: 12 });
    expect(apiMock.post).toHaveBeenCalledWith(
      `/channels/${BOARD}/board/purge`,
      { createdBy: BOB, rect: { x: 10, y: 20, w: 300, h: 400 } },
      expect.anything(),
    );
  });

  it('surfaces 403 and 429 Retry-After errors as user-readable messages', async () => {
    apiMock.post.mockRejectedValueOnce({ response: { status: 403, data: { error: 'Forbidden' } } });
    await expect(adapter.purge!({ createdBy: BOB })).rejects.toThrow('Forbidden');

    apiMock.post.mockRejectedValueOnce({ response: { status: 429, headers: { 'Retry-After': '4' }, data: {} } });
    await expect(adapter.purge!({ createdBy: BOB })).rejects.toThrow(/4s/);
  });
});
