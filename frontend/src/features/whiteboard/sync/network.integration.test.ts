/**
 * Integration: TWO real clients -- networkAdapter + coordinator + store + input
 * controller, composed by connectBoard exactly as WhiteboardChannel composes
 * them -- against a fake gateway + HTTP server that speaks the Go backend's
 * exact wire format (backend/internal/gateway/board*.go, internal/whiteboard).
 * The golden payloads below were captured from the real backend; if either
 * side drifts, these tests fail without a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, PresenceParticipant, StickyObject } from '../contract';

// ---- golden wire captures (real Go server, local dev run) ------------------

const BOARD = '48ad78db-4132-4ad5-9199-f08ce37f14ee';
const ALICE = '30a8529f-7574-452b-bc50-ab2fa3cd85b5'; // "manual1"
const BOB = '2f0e6001-3962-4a16-8423-34b63d7c7fc3'; // "manual2"
const OBJ = '68ec0e7b-bf75-40a1-bdc4-75067438ee37';

const GOLDEN = {
  SUBSCRIBED_two: `{"op":"BOARD_SUBSCRIBED","d":{"channelId":"${BOARD}","seq":3,"participants":[{"userId":"${BOB}","name":"manual2","colourIndex":1},{"userId":"${ALICE}","name":"manual1","colourIndex":0}]},"s":121}`,
  JOIN_self: `{"op":"BOARD_JOIN","d":{"channelId":"${BOARD}","userId":"${ALICE}","name":"manual1","colourIndex":0},"s":120}`,
  GET_board: '{"data":{"seq":3,"objects":[]}}',
  COMMIT_create: `{"op":"BOARD_COMMIT","d":{"channelId":"${BOARD}","opId":"d7312ced-0322-41b3-825c-51f2dc86186c","seq":4,"userId":"${ALICE}","changes":[{"id":"${OBJ}","action":"create","version":4,"body":{"createdBy":"${ALICE}","h":200,"id":"${OBJ}","kind":"sticky","rank":"1:aV","style":{"font":"handwriting","tone":"yellow"},"text":"wire test","version":4,"w":200,"x":100,"y":100}}]},"s":124}`,
  COMMIT_update: `{"op":"BOARD_COMMIT","d":{"channelId":"${BOARD}","opId":"1715ba7b-8e53-4f8d-9f0e-9e5bc8f08c7e","seq":5,"userId":"${BOB}","changes":[{"id":"${OBJ}","action":"update","version":5,"patch":{"x":300}}]},"s":126}`,
  POST_409: `{"seq":5,"error":"object was changed by someone else","code":"conflict","current":[{"createdBy":"${ALICE}","h":200,"id":"${OBJ}","kind":"sticky","rank":"1:aV","style":{"font":"handwriting","tone":"yellow"},"text":"wire test","version":5,"w":200,"x":300,"y":100}]}`,
  POST_400: '{"error":"field \\"kind\\" cannot be patched"}',
  PRESENCE: `{"op":"BOARD_PRESENCE","d":{"channelId":"${BOARD}","cursor":{"x":1,"y":2},"selectedIds":["${OBJ}"],"userId":"${BOB}"},"s":127}`,
  PRESENCE_drag: `{"op":"BOARD_PRESENCE","d":{"channelId":"${BOARD}","drag":{"ids":["${OBJ}"],"dx":5,"dy":6},"userId":"${BOB}"},"s":128}`,
  PRESENCE_clear: `{"op":"BOARD_PRESENCE","d":{"channelId":"${BOARD}","cursor":null,"drag":null,"userId":"${BOB}"},"s":129}`,
  LEAVE: `{"op":"BOARD_LEAVE","d":{"channelId":"${BOARD}","userId":"${BOB}"},"s":327}`,
};

// ---- fake backend ------------------------------------------------------------

const NAMES: Record<string, string> = { [ALICE]: 'manual1', [BOB]: 'manual2' };
const MAX_PRESENCE_BYTES = 2048; // gateway maxBoardPresenceBytes
const MAX_FRAME_BYTES = 4096; // gateway maxMessageSize (read limit closes the socket)

interface Conn {
  readonly userId: string;
  open: boolean;
  rooms: Set<string>;
  tokens: number;
  last: number;
  presence: Map<string, Record<string, unknown>>; // coalesced per sender
  ready: Set<() => void>;
  close: Set<() => void>;
  events: Map<string, Set<(d: unknown) => void>>;
  queue: string[];
}

interface HttpError { response: { status: number; data: unknown } }

/** Mirrors the Go hub/room/service semantics the client relies on, JSON on the wire. */
function createServer() {
  let seq = 0;
  let s = 0;
  const objects = new Map<string, Record<string, unknown>>();
  const conns = new Set<Conn>();
  const room = new Map<Conn, true>();
  const colours = new Map<string, number>();
  const stats = { droppedPresence: 0, oversizedFrames: 0, frames: 0 };

  /** Reliable path: JSON strings through the socket, strictly FIFO per connection (like TCP). */
  function deliver(conn: Conn, op: string, d: unknown): void {
    conn.queue.push(JSON.stringify({ op, d, s: ++s }));
    if (conn.queue.length > 1) return;
    setTimeout(() => {
      while (conn.queue.length) {
        const raw = conn.queue[0];
        if (!conn.open) { conn.queue.length = 0; return; }
        const event = JSON.parse(raw) as { op: string; d: unknown };
        for (const listener of [...(conn.events.get(event.op) ?? [])]) listener(event.d);
        conn.queue.shift();
      }
    }, 0);
  }
  function participants() {
    const users = new Set([...room.keys()].map(c => c.userId));
    return [...users].sort().map(userId => ({ userId, name: NAMES[userId], colourIndex: colours.get(userId)! }));
  }
  function roomEvent(op: string, d: unknown): void {
    for (const conn of room.keys()) deliver(conn, op, d);
  }
  function leave(conn: Conn): void {
    if (!room.delete(conn)) return;
    conn.rooms.delete(BOARD);
    if ([...room.keys()].some(c => c.userId === conn.userId)) return;
    colours.delete(conn.userId);
    for (const other of room.keys()) other.presence.delete(conn.userId);
    roomEvent('BOARD_LEAVE', { channelId: BOARD, userId: conn.userId });
  }

  function receive(conn: Conn, frame: string): void {
    stats.frames++;
    if (new TextEncoder().encode(frame).byteLength > MAX_FRAME_BYTES) { stats.oversizedFrames++; return; }
    const { op, d } = JSON.parse(frame) as { op: string; d: Record<string, unknown> };
    if (op === 'BOARD_SUBSCRIBE') {
      if (d.channelId !== BOARD) return; // not a board: ignored, no SUBSCRIBED
      const present = [...room.keys()].some(c => c.userId === conn.userId);
      if (!present) {
        const used = new Set(colours.values());
        let colour = 0;
        while (used.has(colour)) colour++;
        colours.set(conn.userId, colour);
      }
      room.set(conn, true);
      conn.rooms.add(BOARD);
      deliver(conn, 'BOARD_SUBSCRIBED', { channelId: BOARD, seq, participants: participants() });
      if (!present) roomEvent('BOARD_JOIN', { channelId: BOARD, userId: conn.userId, name: NAMES[conn.userId], colourIndex: colours.get(conn.userId) });
    } else if (op === 'BOARD_UNSUBSCRIBE') {
      leave(conn);
    } else if (op === 'BOARD_PRESENCE') {
      if (new TextEncoder().encode(JSON.stringify(d)).byteLength > MAX_PRESENCE_BYTES) { stats.droppedPresence++; return; }
      // presenceBucket: 20 tokens/s, burst 20, per connection.
      const now = Date.now();
      conn.tokens = conn.last ? Math.min(20, conn.tokens + ((now - conn.last) / 1000) * 20) : 20;
      conn.last = now;
      if (conn.tokens < 1) { stats.droppedPresence++; return; }
      conn.tokens--;
      if (!room.has(conn)) return;
      const clean: Record<string, unknown> = { channelId: BOARD, userId: conn.userId };
      for (const key of ['cursor', 'selectedIds', 'editingId', 'drag', 'viewport']) if (key in d) clean[key] = d[key];
      for (const other of room.keys()) {
        if (other === conn) continue;
        other.presence.set(conn.userId, { ...(other.presence.get(conn.userId) ?? {}), ...clean });
      }
    }
  }

  // The socket writer flushes coalesced presence every 50 ms.
  const ticker = setInterval(() => {
    for (const conn of room.keys()) {
      for (const [, fields] of conn.presence) deliver(conn, 'BOARD_PRESENCE', fields);
      conn.presence.clear();
    }
  }, 50);

  function connect(conn: Conn): void {
    conn.open = true;
    conns.add(conn);
    setTimeout(() => { if (conn.open) for (const l of [...conn.ready]) l(); }, 0); // READY
  }
  function drop(conn: Conn): void {
    if (!conn.open) return;
    conn.open = false;
    leave(conn);
    for (const l of [...conn.close]) l();
  }

  function http(userId: string) {
    const wire = (body: string) => Promise.resolve({ data: JSON.parse(body) as unknown });
    const fail = (status: number, body: unknown): Promise<never> =>
      Promise.reject({ response: { status, data: JSON.parse(JSON.stringify(body)) } } satisfies HttpError);
    return {
      get(path: string) {
        if (path !== `/channels/${BOARD}/board`) return fail(400, { error: 'channel is not a board' });
        return wire(JSON.stringify({ data: { seq, objects: [...objects.values()] } }));
      },
      post(path: string, raw: Command) {
        if (path !== `/channels/${BOARD}/board/ops`) return fail(404, { error: 'Not Found' });
        const command = JSON.parse(JSON.stringify(raw)) as Command;
        const current = command.changes.flatMap(c => (objects.has(c.id) ? [objects.get(c.id)!] : []));
        for (const change of command.changes) {
          const existing = objects.get(change.id);
          if (change.action === 'create' ? !!existing : !existing) {
            return fail(409, { seq, error: change.action === 'create' ? 'object was changed by someone else' : 'object no longer exists', code: change.action === 'create' ? 'conflict' : 'gone', current });
          }
          if (change.action !== 'create' && existing!.version !== change.expectedVersion) {
            return fail(409, { seq, error: 'object was changed by someone else', code: 'conflict', current });
          }
          if (change.action === 'update' && 'kind' in change.patch) return fail(400, { error: 'field "kind" cannot be patched' });
        }
        seq++;
        const changes = command.changes.map(change => {
          if (change.action === 'create') {
            const body = { ...change.body, version: seq } as Record<string, unknown>;
            objects.set(change.id, body);
            return { id: change.id, action: 'create', version: seq, body };
          }
          if (change.action === 'update') {
            objects.set(change.id, { ...objects.get(change.id)!, ...change.patch, version: seq });
            return { id: change.id, action: 'update', version: seq, patch: change.patch };
          }
          objects.delete(change.id);
          return { id: change.id, action: 'delete', version: seq };
        });
        // Go publishes the commit synchronously before answering the request.
        roomEvent('BOARD_COMMIT', { channelId: BOARD, opId: command.opId, seq, userId, changes });
        return wire(JSON.stringify({ data: { seq, changes: changes.map(({ id, action, version }) => ({ id, action, version })) } }));
      },
    };
  }

  return {
    stats, objects, connect, drop, receive, http, conns,
    createObject(body: Record<string, unknown>): void {
      seq++;
      objects.set(body.id as string, { ...body, version: seq });
      roomEvent('BOARD_COMMIT', { channelId: BOARD, opId: crypto.randomUUID(), seq, userId: body.createdBy, changes: [{ id: body.id, action: 'create', version: seq, body: { ...body, version: seq } }] });
    },
    dispose(): void { clearInterval(ticker); },
  };
}

type Server = ReturnType<typeof createServer>;

// ---- clients -------------------------------------------------------------------

async function loadClient(server: Server, userId: string) {
  const conn: Conn = {
    userId, open: false, rooms: new Set(), tokens: 20, last: 0, presence: new Map(),
    ready: new Set(), close: new Set(), events: new Map(), queue: [],
  };
  vi.resetModules();
  vi.doMock('../../../hooks/useGateway', () => ({
    sendGateway(op: string, d: unknown): boolean {
      if (!conn.open) return false;
      server.receive(conn, JSON.stringify({ op, d }));
      return true;
    },
    onGatewayReady(l: () => void) { conn.ready.add(l); return () => { conn.ready.delete(l); }; },
    onGatewayClose(l: () => void) { conn.close.add(l); return () => { conn.close.delete(l); }; },
    onGatewayEvent(op: string, l: (d: unknown) => void) {
      let set = conn.events.get(op);
      if (!set) conn.events.set(op, set = new Set());
      set.add(l);
      return () => { set.delete(l); };
    },
  }));
  vi.doMock('../../../lib/api', () => ({ api: server.http(userId) }));
  const { connectBoard, createBoardResources } = await import('../localBoard');
  const element = document.createElement('div');
  element.setAttribute('data-wb-viewport', '');
  document.body.appendChild(element);
  const resources = createBoardResources({ boardId: BOARD, userId });
  server.connect(conn);
  const connection = connectBoard(resources, { element });
  // Both clients share one jsdom window (controllers also listen there), so keep pointers distinct.
  const pointerId = userId === ALICE ? 1 : 2;
  function pointer(type: string, x: number, y: number): void {
    element.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId, button: 0, pointerType: 'mouse',
    }));
  }
  return {
    conn, element, connection, ...resources, pointer,
    presence: (): readonly PresenceParticipant[] => connection.adapter.getPresence(),
    other: (id: string) => connection.adapter.getPresence().find(p => p.userId === id),
  };
}

async function run(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

function sticky(id: string, createdBy: string, x = 100, y = 100): StickyObject {
  return {
    id, kind: 'sticky', rank: '1:aV', version: 0, createdBy, x, y, w: 200, h: 200, text: 'hi',
    style: { tone: 'yellow', font: 'handwriting' },
  };
}

let server: Server;
const disposers: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  document.body.innerHTML = '';
  server = createServer();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  server.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.doUnmock('../../../hooks/useGateway');
  vi.doUnmock('../../../lib/api');
});

async function twoClients() {
  const a = await loadClient(server, ALICE);
  disposers.push(() => a.connection.dispose());
  await run();
  await a.connection.started;
  const b = await loadClient(server, BOB);
  disposers.push(() => b.connection.dispose());
  await run();
  await b.connection.started;
  await run(300);
  return { a, b };
}

// ---- tests -------------------------------------------------------------------------

describe('golden payloads from the Go backend parse as the contract expects', () => {
  it('SUBSCRIBED / JOIN / COMMIT / PRESENCE / LEAVE / 409 / 400', async () => {
    const http = {
      get: vi.fn(() => Promise.resolve({ data: JSON.parse(GOLDEN.GET_board) })),
      post: vi.fn(),
    };
    const events = new Map<string, Set<(d: unknown) => void>>();
    const sent: { op: string; d: unknown }[] = [];
    vi.resetModules();
    vi.doMock('../../../hooks/useGateway', () => ({
      sendGateway: (op: string, d: unknown) => { sent.push({ op, d }); return true; },
      onGatewayReady: () => () => {},
      onGatewayClose: () => () => {},
      onGatewayEvent: (op: string, l: (d: unknown) => void) => {
        let set = events.get(op);
        if (!set) events.set(op, set = new Set());
        set.add(l);
        return () => { set.delete(l); };
      },
    }));
    vi.doMock('../../../lib/api', () => ({ api: http }));
    const { createNetworkAdapter } = await import('./networkAdapter');
    const wire = (raw: string) => {
      const { op, d } = JSON.parse(raw) as { op: string; d: unknown };
      for (const l of [...(events.get(op) ?? [])]) l(d);
    };
    const adapter = createNetworkAdapter({ boardId: BOARD, userId: ALICE });
    disposers.push(() => adapter.dispose());
    const commits: number[] = [];
    adapter.onCommit(c => commits.push(c.seq));
    const connecting = adapter.connect();
    expect(sent).toEqual([{ op: 'BOARD_SUBSCRIBE', d: { channelId: BOARD } }]);
    wire(GOLDEN.SUBSCRIBED_two);
    wire(GOLDEN.JOIN_self); // the Go hub sends the subscriber its own JOIN after SUBSCRIBED
    await expect(connecting).resolves.toEqual({ seq: 3, objects: [] });
    await run();
    // Self is included (Participants shows it first) exactly once; drawing consumers skip it.
    expect(adapter.getPresence().map(p => [p.userId, p.name, p.colourIndex])).toEqual([[BOB, 'manual2', 1], [ALICE, 'manual1', 0]]);

    wire(GOLDEN.COMMIT_create);
    wire(GOLDEN.COMMIT_update);
    expect(commits).toEqual([4, 5]);

    wire(GOLDEN.PRESENCE);
    expect(adapter.getPresence().find(p => p.userId === BOB)).toMatchObject({ cursor: { x: 1, y: 2 }, selectedIds: [OBJ] });
    wire(GOLDEN.PRESENCE_drag);
    expect(adapter.getPresence().find(p => p.userId === BOB)).toMatchObject({ cursor: { x: 1, y: 2 }, drag: { ids: [OBJ], dx: 5, dy: 6 } });
    wire(GOLDEN.PRESENCE_clear);
    expect(adapter.getPresence().find(p => p.userId === BOB)).toMatchObject({ cursor: null, drag: null, selectedIds: [OBJ] });
    wire(GOLDEN.LEAVE);
    expect(adapter.getPresence().map(p => p.userId)).toEqual([ALICE]);

    const command: Command = { opId: crypto.randomUUID(), changes: [{ id: OBJ, action: 'update', expectedVersion: 4, patch: { x: 999 } }] };
    http.post.mockRejectedValueOnce({ response: { status: 409, data: JSON.parse(GOLDEN.POST_409) } });
    await expect(adapter.submit(command)).resolves.toMatchObject({
      opId: command.opId, code: 'conflict', seq: 5, error: 'object was changed by someone else', current: [{ id: OBJ, x: 300, version: 5 }],
    });
    http.post.mockRejectedValueOnce({ response: { status: 400, data: JSON.parse(GOLDEN.POST_400) } });
    await expect(adapter.submit(command)).resolves.toMatchObject({ code: 'invalid', error: 'field "kind" cannot be patched', current: [] });
  });
});

describe('two real clients against the fake Go backend', () => {
  it('connect: both go live with a silent status; the room includes self, each with its server colour', async () => {
    const { a, b } = await twoClients();
    expect(a.connection.adapter.getStatus()).toBe('live');
    expect(b.connection.adapter.getStatus()).toBe('live');
    expect(a.presence().map(p => [p.userId, p.colourIndex]).sort()).toEqual([[ALICE, 0], [BOB, 1]].sort());
    expect(b.presence().map(p => [p.userId, p.name]).sort()).toEqual([[ALICE, 'manual1'], [BOB, 'manual2']].sort());
  });

  it('a create on A appears on B without reload and both converge on the server version', async () => {
    const { a, b } = await twoClients();
    const id = crypto.randomUUID();
    a.store.dispatch([{ id, action: 'create', expectedVersion: 0, body: sticky(id, ALICE) }]);
    await run();
    expect(b.store.getObject(id)).toMatchObject({ kind: 'sticky', text: 'hi', version: 1, createdBy: ALICE });
    expect(a.store.getObject(id)).toMatchObject({ version: 1 });
    expect(a.store.getPendingOperations()).toEqual([]);
    expect(server.objects.get(id)).toMatchObject({ version: 1 });
  });

  it('presence: B\'s cursor, selection and drag reach A; drag=null clears; A never sees its own presence', async () => {
    const { a, b } = await twoClients();
    const id = crypto.randomUUID();
    server.createObject({ ...sticky(id, BOB, 0, 0) });
    await run();
    b.pointer('pointermove', 30, 40);
    await run(60);
    expect(a.other(BOB)!.cursor).toEqual({ x: 30, y: 40 });
    expect(a.other(ALICE)!.cursor).toBeNull();

    // B drags the sticky: A sees the drag (ghost), then exactly one final commit and drag=null.
    b.pointer('pointerdown', 50, 50);
    for (let i = 1; i <= 10; i++) { b.pointer('pointermove', 50 + i * 10, 50 + i * 5); await run(20); }
    await run(250);
    expect(a.other(BOB)!.selectedIds).toEqual([id]);
    expect(a.other(BOB)!.drag).toMatchObject({ ids: [id] });
    b.pointer('pointerup', 150, 100);
    await run(400);
    expect(a.other(BOB)!.drag).toBeNull();
    expect(a.store.getObject(id)).toMatchObject({ x: 100, y: 50, version: 2 });
    expect(server.objects.size).toBe(1);
    expect(server.stats.droppedPresence).toBe(0);
  });

  it('soft lock: A cannot start moving an object B is dragging', async () => {
    const { a, b } = await twoClients();
    const id = crypto.randomUUID();
    server.createObject({ ...sticky(id, BOB, 0, 0) });
    await run();
    b.pointer('pointerdown', 50, 50);
    b.pointer('pointermove', 70, 70);
    await run(250);
    a.pointer('pointerdown', 60, 60);
    a.pointer('pointermove', 120, 120);
    a.pointer('pointerup', 120, 120);
    await run(300);
    expect(a.notices.getLatest()?.message).toMatch(/manual2 is moving this/);
    expect(server.objects.get(id)).toMatchObject({ x: 0, y: 0, version: 1 });
    b.pointer('pointerup', 70, 70);
    await run(300);
  });

  it('simultaneous edits of one object: one wins, the loser adopts it, nothing duplicates', async () => {
    const { a, b } = await twoClients();
    const id = crypto.randomUUID();
    server.createObject({ ...sticky(id, ALICE) });
    await run();
    // Both dispatch before either hears about the other's commit.
    a.store.dispatch([{ id, action: 'update', expectedVersion: 1, patch: { x: 500 } }]);
    b.store.dispatch([{ id, action: 'update', expectedVersion: 1, patch: { x: -500 } }]);
    await run(500);
    const winner = server.objects.get(id)!.x;
    expect(a.store.getObject(id)!.x).toBe(winner);
    expect(b.store.getObject(id)!.x).toBe(winner);
    expect(a.store.getObjectIds()).toEqual([id]);
    expect(b.store.getObjectIds()).toEqual([id]);
    expect(a.store.getPendingOperations()).toEqual([]);
    expect(b.store.getPendingOperations()).toEqual([]);
  });

  it('undo on A never reverts B\'s later work', async () => {
    const { a, b } = await twoClients();
    const id = crypto.randomUUID();
    a.store.dispatch([{ id, action: 'create', expectedVersion: 0, body: sticky(id, ALICE) }]);
    await run();
    a.store.dispatch([{ id, action: 'update', expectedVersion: 1, patch: { x: 200 } }]);
    await run();
    b.store.dispatch([{ id, action: 'update', expectedVersion: 2, patch: { x: 900, text: 'bob' } }]);
    await run();
    a.store.undo();
    await run(300);
    expect(server.objects.get(id)).toMatchObject({ x: 900, text: 'bob' });
    expect(a.store.getObject(id)).toMatchObject({ x: 900, text: 'bob' });
    expect(b.store.getObject(id)).toMatchObject({ x: 900, text: 'bob' });
  });

  it('a dropped socket re-subscribes on READY and resyncs what it missed; the peer sees LEAVE then JOIN', async () => {
    const { a, b } = await twoClients();
    server.drop(a.conn);
    await run();
    expect(a.connection.adapter.getStatus()).toBe('offline');
    expect(b.presence().map(p => p.userId)).toEqual([BOB]);
    const missed = crypto.randomUUID();
    b.store.dispatch([{ id: missed, action: 'create', expectedVersion: 0, body: sticky(missed, BOB) }]);
    await run();
    expect(a.store.getObject(missed)).toBeUndefined();
    server.connect(a.conn);
    await run(300);
    expect(a.connection.adapter.getStatus()).toBe('live');
    expect(a.store.getObject(missed)).toMatchObject({ version: 1, createdBy: BOB });
    expect(b.presence().map(p => p.userId).sort()).toEqual([ALICE, BOB].sort());
    expect(a.presence().map(p => p.userId).sort()).toEqual([ALICE, BOB].sort());
  });

  it('leaving the channel (dispose) removes the participant on the other side', async () => {
    const { a, b } = await twoClients();
    b.connection.dispose();
    await run(100);
    expect(a.presence().map(p => p.userId)).toEqual([ALICE]);
  });

  it('sustained pointer streaming stays within the server presence budget and frame limit', async () => {
    const { a, b } = await twoClients();
    const ids = Array.from({ length: 120 }, () => crypto.randomUUID());
    for (const id of ids) server.createObject({ ...sticky(id, BOB, 0, 0) });
    await run();
    b.session.setSelectedIds(ids); // a large selection: the payload must be shrunk to fit
    // Drag the whole selection with a ~144 Hz mouse for 10 s: cursor + drag on every move.
    b.pointer('pointerdown', 10, 10);
    for (let t = 7; t < 10_000; t += 7) {
      b.pointer('pointermove', 10 + (t % 300), 10);
      await vi.advanceTimersByTimeAsync(7);
    }
    await run(300);
    expect(a.other(BOB)!.drag?.ids.length).toBeGreaterThan(0);
    b.pointer('pointerup', 10, 10);
    await run(300);
    expect(a.other(BOB)!.drag).toBeNull();
    expect(server.stats.droppedPresence).toBe(0);
    expect(server.stats.oversizedFrames).toBe(0);
    expect(a.other(BOB)!.cursor).not.toBeNull();
  });
});

