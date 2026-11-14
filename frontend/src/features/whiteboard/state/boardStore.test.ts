import { describe, expect, it, vi } from 'vitest';
import type { Change, Commit, RectObject } from '../contract';
import { OP_IDEMPOTENCY_TTL_MS } from '../contract';
import { createBoardStore } from './boardStore';
import type { ManagedBoardStore } from './boardStore';

function rect(id = 'a', version = 1, x = 0): RectObject {
  return {
    id, version, x, y: 0, w: 100, h: 100, kind: 'rect', rank: '1:a', createdBy: 'me',
    style: { colour: 'ink', weight: 'thin', fill: 'none' },
  };
}
function setup(objects = [rect()], seq = 1, historyLimit = 100): ManagedBoardStore {
  let counter = 0;
  const store = createBoardStore({ boardId: 'board', userId: 'me', createOpId: () => `op-${++counter}`, historyLimit });
  store.hydrate({ seq, objects });
  return store;
}
function update(id = 'a', expectedVersion = 1, x = 10): Change {
  return { id, action: 'update', expectedVersion, patch: { x } };
}
function ack(store: ManagedBoardStore, opId: string, seq: number): void {
  const operation = store.getPendingOperations().find(item => item.command.opId === opId)!;
  store.acknowledge(opId, {
    seq, changes: operation.command.changes.map(change => ({ id: change.id, action: change.action, version: seq })),
  });
}
function remote(seq: number, id = 'a', x = 20): Commit {
  return {
    channelId: 'board', userId: 'other', opId: `remote-${seq}`, seq,
    changes: [{ id, action: 'update', patch: { x }, version: seq }],
  };
}

describe('board reconciliation', () => {
  it('optimistically applies, then adopts the server seq rather than incrementing locally', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    expect(store.getObject('a')).toMatchObject({ x: 10, version: 1 });
    expect(store.getSeq()).toBe(1);
    ack(store, opId, 2);
    expect(store.getObject('a')).toMatchObject({ x: 10, version: 2 });
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getSeq()).toBe(2);
  });

  it('handles optimistic create, delete, HTTP-first and gateway-first duplicates', () => {
    const store = setup([], 0);
    const created = store.dispatch([{ id: 'a', action: 'create', expectedVersion: 0, body: rect('a', 0) }]);
    expect(store.getObject('a')?.version).toBe(0);
    const commit: Commit = {
      ...remote(1), opId: created, userId: 'me',
      changes: [{ id: 'a', action: 'create', body: rect(), version: 1 }],
    };
    store.applyCommit(commit);
    store.acknowledge(created, { seq: 1, changes: [{ id: 'a', action: 'create', version: 1 }] });
    store.applyCommit(commit);
    expect(store.getObjectsInRank()).toEqual([rect()]);
    const deleted = store.dispatch([{ id: 'a', action: 'delete', expectedVersion: 1 }]);
    expect(store.getObject('a')).toBeUndefined();
    ack(store, deleted, 2);
    store.applyCommit({ ...remote(2), opId: deleted, changes: [{ id: 'a', action: 'delete', version: 2 }] });
    expect(store.getObjectIds()).toEqual([]);
    expect(store.getSeq()).toBe(2);
  });

  it('stamps creation ownership and sends explicit absence without mutating caller bodies', () => {
    const store = setup([], 0);
    const body = { ...rect('a', 0), createdBy: 'someone-else' };
    store.dispatch([{ id: 'a', action: 'create', expectedVersion: 0, body }]);
    expect(store.getPendingOperations()[0].command.changes[0]).toMatchObject({
      id: 'a', expectedVersion: 0, body: { id: 'a', version: 0, createdBy: 'me' },
    });
    expect(body.createdBy).toBe('someone-else');
  });

  it('adopts full conflict objects, never merges them with the failed optimistic patch', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    store.applyReject({ opId, code: 'conflict', seq: 4, error: 'stale', current: [{ ...rect('a', 4, 40), y: 8 }] });
    expect(store.getObject('a')).toMatchObject({ x: 40, y: 8, version: 4 });
    expect(store.getSeq()).toBe(1);
    store.applyCommit(remote(2));
    store.applyCommit(remote(3));
    expect(store.getObject('a')).toMatchObject({ x: 40, version: 4 });
    expect(store.canUndo()).toBe(false);
  });

  it('gone removes touched objects, but invalid/limit/forbidden never imply deletion', () => {
    for (const code of ['invalid', 'limit', 'forbidden', 'gone', 'conflict'] as const) {
      const store = setup();
      const opId = store.dispatch([update()]);
      store.applyReject(code === 'gone' || code === 'conflict'
        ? { opId, code, seq: 1, error: code, current: [] }
        : { opId, code, error: code, current: [] });
      expect(store.getObject('a')).toEqual(code === 'gone' || code === 'conflict' ? undefined : rect());
    }
  });

  it('late rejects cannot overwrite or remove a newer remote object', () => {
    for (const current of [[], [rect('a', 1)]]) {
      const store = setup();
      const opId = store.dispatch([update()]);
      store.applyCommit(remote(2, 'a', 50));
      store.applyReject({ opId, code: 'gone', seq: 1, error: 'late', current });
      expect(store.getObject('a')).toMatchObject({ version: 2, x: 50 });
    }
  });

  it('does not resurrect tombstones with a stale reject body', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    store.applyCommit({ ...remote(2), changes: [{ id: 'a', action: 'delete', version: 2 }] });
    store.applyReject({ opId, code: 'conflict', seq: 1, error: 'late', current: [rect()] });
    expect(store.getObject('a')).toBeUndefined();
  });

  it('uses gone evaluation seq to prevent delayed commits resurrecting an absent object', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    store.applyCommit(remote(2, 'a', 22));
    store.applyReject({ opId, code: 'gone', seq: 4, error: 'gone', current: [] });
    expect(store.getObject('a')).toBeUndefined();
    expect(store.getSeq()).toBe(2);
    expect(store.getGap()).toEqual({ expectedSeq: 3, receivedSeq: 4 });
    store.applyCommit(remote(3, 'a', 33));
    expect(store.getObject('a')).toBeUndefined();
    store.applyCommit({ ...remote(4), changes: [{ id: 'a', action: 'delete', version: 4 }] });
    expect(store.getGap()).toBeNull();
    store.applyCommit({ ...remote(5), changes: [{ id: 'a', action: 'create', version: 5, body: rect('a', 5, 55) }] });
    expect(store.getObject('a')).toMatchObject({ x: 55, version: 5 });
  });

  it('never resurrects a snapshot absence from an older reject, or rewinds reject evidence with an old GET', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    store.markSending(opId);
    store.hydrate({ seq: 5, objects: [] });
    store.applyReject({ opId, code: 'conflict', seq: 3, error: 'late', current: [rect('a', 3)] });
    expect(store.getObject('a')).toBeUndefined();
    const created = store.dispatch([{ id: 'a', action: 'create', expectedVersion: 0, body: rect('a', 0) }]);
    store.applyReject({ opId: created, code: 'conflict', seq: 8, error: 'taken', current: [rect('a', 8, 80)] });
    store.hydrate({ seq: 6, objects: [] });
    expect(store.getObject('a')).toMatchObject({ x: 80, version: 8 });
    expect(store.getGap()).toEqual({ expectedSeq: 6, receivedSeq: 8 });
    store.hydrate({ seq: 8, objects: [rect('a', 8, 80)] });
    expect(store.getGap()).toBeNull();
  });

  it('rebases compatible pending work on hydrate, preserving commands and stable objects', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    const object = store.getObject('a');
    const command = store.getPendingOperations()[0].command;
    store.hydrate({ seq: 3, objects: [rect(), rect('b', 3)] });
    expect(store.getObject('a')).toBe(object);
    expect(store.getPendingOperations()[0].command).toBe(command);
    expect(store.getPendingOperations()[0].command.opId).toBe(opId);
    expect(store.getObjectIds()).toEqual(['a', 'b']);
  });

  it('never retargets incompatible pending writes to a remote version after hydrate', () => {
    const store = setup();
    store.dispatch([update()]);
    store.hydrate({ seq: 3, objects: [rect('a', 3, 33)] });
    expect(store.getObject('a')).toMatchObject({ x: 33, version: 3 });
    expect(store.getPendingOperations()[0].command.changes[0]).toMatchObject({ expectedVersion: 1 });
  });

  it('drops unsent missing-object work and dependent operations, not pending creates', () => {
    const store = setup();
    store.dispatch([update()]);
    store.dispatch([update('a', 1, 30)]);
    store.dispatch([{ id: 'b', action: 'create', expectedVersion: 0, body: rect('b', 0) }]);
    store.hydrate({ seq: 3, objects: [] });
    expect(store.getPendingOperations()).toHaveLength(1);
    expect(store.getObjectIds()).toEqual(['b']);
  });

  it('keeps already-sent unknown commands byte-for-byte when hydrate finds the object gone', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    store.markSending(opId);
    const command = store.getPendingOperations()[0].command;
    store.hydrate({ seq: 3, objects: [] });
    expect(store.getObject('a')).toBeUndefined();
    expect(store.getPendingOperations()[0].command).toBe(command);
    expect(store.markSending(opId)).toBe(true);
    expect(store.getPendingOperations()[0].command).toBe(command);
    ack(store, opId, 2);
    expect(store.getObject('a')).toBeUndefined();
    expect(store.getPendingOperations()).toEqual([]);
  });

  it('buffers gaps, keeps seq contiguous, and drains atomically without duplicate notifications', () => {
    const store = setup();
    const listener = vi.fn();
    const gapListener = vi.fn();
    store.subscribeObject('a', listener);
    store.subscribeGap(gapListener);
    store.applyCommit(remote(3, 'a', 30));
    expect(store.getGap()).toEqual({ expectedSeq: 2, receivedSeq: 3 });
    expect(store.getSeq()).toBe(1);
    expect(listener).not.toHaveBeenCalled();
    store.applyCommit(remote(2, 'a', 20));
    expect(store.getSeq()).toBe(3);
    expect(store.getObject('a')).toMatchObject({ x: 30, version: 3 });
    expect(store.getGap()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(gapListener).toHaveBeenCalledTimes(2);
    store.applyCommit(remote(3, 'a', 30));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('retains buffered acknowledged overlay until ordered integration and drops it on refetch', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    ack(store, opId, 4);
    expect(store.getPendingOperations()[0]).toMatchObject({ status: 'acknowledged', acknowledgedSeq: 4 });
    expect(store.getSeq()).toBe(1);
    expect(store.canSend(opId)).toBe(false);
    store.hydrate({ seq: 4, objects: [rect('a', 4, 10)] });
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getObject('a')?.version).toBe(4);
    expect(store.getGap()).toBeNull();
  });

  it('keeps pending snapshots stable on duplicate buffered acknowledgements', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    ack(store, opId, 4);
    const pending = store.getPendingOperations();
    const listener = vi.fn();
    store.subscribePending(listener);
    ack(store, opId, 4);
    expect(store.getPendingOperations()).toBe(pending);
    expect(listener).not.toHaveBeenCalled();
  });

  it('acknowledges a matching old op without changing the newer snapshot', () => {
    const store = setup();
    const opId = store.dispatch([update()]);
    store.hydrate({ seq: 5, objects: [rect('a', 5, 50)] });
    ack(store, opId, 2);
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getObject('a')).toMatchObject({ x: 50, version: 5 });
    expect(store.undo()).toBeNull();
    expect(store.getHistoryReport()?.skipped).toEqual([{ id: 'a', reason: 'changed' }]);
  });

  it('serializes own dependent writes and resolves local-only version zero on own ack', () => {
    const store = setup([], 0);
    const create = store.dispatch([{ id: 'a', action: 'create', expectedVersion: 0, body: rect('a', 0) }]);
    const move = store.dispatch([update('a', 0, 10)]);
    const secondMove = store.dispatch([update('a', 0, 20)]);
    expect(store.getObject('a')).toMatchObject({ x: 20, version: 0 });
    expect(store.markSending(move)).toBe(false);
    ack(store, create, 1);
    expect(store.getObject('a')).toMatchObject({ x: 20, version: 1 });
    expect(store.getPendingOperations()[0].command.changes[0]).toMatchObject({ expectedVersion: 1 });
    expect(store.canSend(move)).toBe(true);
    expect(store.canSend(secondMove)).toBe(false);
    ack(store, move, 2);
    expect(store.getPendingOperations()[0].command.changes[0]).toMatchObject({ expectedVersion: 2 });
    ack(store, secondMove, 3);
    expect(store.getObject('a')).toMatchObject({ x: 20, version: 3 });
  });

  it('cancels a dependency chain on predecessor rejection but leaves unrelated work', () => {
    const store = setup([rect(), rect('b')]);
    const first = store.dispatch([update()]);
    store.dispatch([update('a', 1, 20)]);
    const other = store.dispatch([update('b')]);
    store.applyReject({ opId: first, code: 'conflict', seq: 2, error: 'stale', current: [rect('a', 2, 99)] });
    expect(store.getPendingOperations().map(item => item.command.opId)).toEqual([other]);
    expect(store.getObject('a')?.x).toBe(99);
  });

  it('never advances dependent preconditions through remote writes', () => {
    const store = setup();
    const first = store.dispatch([update()]);
    const second = store.dispatch([update('a', 1, 30)]);
    store.applyCommit(remote(3, 'a', 90));
    ack(store, first, 2);
    expect(store.getPendingOperations()[0].command.changes[0]).toMatchObject({ expectedVersion: 2 });
    expect(store.getObject('a')).toMatchObject({ x: 90, version: 3 });
    expect(store.canSend(second)).toBe(true); // Server rejects stale preconditions; never retarget.
  });

  it('tracks two submissions and refuses retries after the idempotency TTL', () => {
    let time = 100;
    const store = createBoardStore({ boardId: 'board', userId: 'me', now: () => time });
    store.hydrate({ seq: 1, objects: [rect(), rect('b')] });
    const opId = store.dispatch([update()]);
    const command = store.getPendingOperations()[0].command;
    expect(store.markSending(opId)).toBe(true);
    expect(store.getSentAt(opId)).toBe(100);
    time = 5100;
    expect(store.markSending(opId)).toBe(true);
    expect(store.getPendingOperations()[0]).toMatchObject({ attempts: 2, status: 'retrying' });
    expect(store.getPendingOperations()[0].command).toBe(command);
    expect(store.markSending(opId)).toBe(false);
    const expired = store.dispatch([update('b')]);
    store.markSending(expired);
    time += OP_IDEMPOTENCY_TTL_MS;
    expect(store.markSending(expired)).toBe(false);
  });

  it('can explicitly abandon unknown outcomes after recovery without losing late accepted commits', () => {
    const store = setup();
    const first = store.dispatch([update()]);
    store.dispatch([update('a', 1, 20)]);
    store.markSending(first);
    store.markSending(first);
    expect(store.canSend(first)).toBe(false);
    store.hydrate({ seq: 1, objects: [rect()] });
    expect(store.abandon(first)).toBe(true);
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getObject('a')).toEqual(rect());
    expect(store.canUndo()).toBe(false);
    store.applyCommit({ ...remote(2, 'a', 10), opId: first, userId: 'me' });
    expect(store.getObject('a')).toMatchObject({ x: 10, version: 2 });
    expect(store.abandon(first)).toBe(false);
    const known = store.dispatch([update('a', 2, 30)]);
    ack(store, known, 4);
    expect(store.abandon(known)).toBe(false);
    expect(store.getPendingOperations()[0].status).toBe('acknowledged');
  });

  it('notifies only affected object subscribers and membership/order subscribers', () => {
    const store = setup([rect(), rect('b')]);
    const a = vi.fn(), b = vi.fn(), ids = vi.fn(), pending = vi.fn(), history = vi.fn();
    const unsubscribe = store.subscribeObject('a', a);
    store.subscribeObject('b', b);
    store.subscribeIds(ids);
    store.subscribePending(pending);
    store.subscribeHistory(history);
    const originalIds = store.getObjectIds();
    const originalB = store.getObject('b');
    const opId = store.dispatch([update()]);
    store.markSending(opId);
    ack(store, opId, 2);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).not.toHaveBeenCalled();
    expect(ids).not.toHaveBeenCalled();
    expect(store.getObjectIds()).toBe(originalIds);
    expect(store.getObject('b')).toBe(originalB);
    expect(pending).toHaveBeenCalledTimes(3);
    expect(history).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.dispatch([{ id: 'a', action: 'update', expectedVersion: 2, patch: { rank: '1:z' } }]);
    expect(store.getObjectIds()).toEqual(['b', 'a']);
    expect(ids).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it('uses code-unit rank/id order with frames behind other objects', () => {
    const store = setup([rect('z'), rect('A'), { ...rect('frame'), kind: 'rect', rank: '0:z' }]);
    expect(store.getObjectIds()).toEqual(['frame', 'A', 'z']);
  });

  it('owns and freezes inputs and validates whole commands before any mutation', () => {
    const store = setup();
    const changes: Change[] = [update()];
    const opId = store.dispatch(changes);
    changes.length = 0;
    expect(store.getPendingOperations()[0].command.changes).toHaveLength(1);
    expect(Object.isFrozen(store.getObject('a'))).toBe(true);
    ack(store, opId, 2);
    expect(() => store.dispatch([update('a', 2), update('missing', 1)])).toThrow();
    expect(store.getPendingOperations()).toEqual([]);
    expect(() => store.dispatch([update('a', 2), update('a', 2)])).toThrow();
  });

  it('rejects empty, partial nested and immutable patches before optimistic mutation', () => {
    const store = setup();
    for (const patch of [{}, { style: { colour: 'red' } }, { id: 'spoof' }, { crop: { x: 0 } }, { x: null }]) {
      expect(() => store.dispatch([{ id: 'a', action: 'update', expectedVersion: 1, patch } as Change])).toThrow();
    }
    expect(store.getObject('a')).toEqual(rect());
    expect(store.getPendingOperations()).toEqual([]);
    store.dispatch([{ id: 'a', action: 'update', expectedVersion: 1,
      patch: { style: { colour: 'red', weight: 'thick', fill: 'solid' } },
    }]);
    expect(store.getObject('a')).toMatchObject({ style: { colour: 'red', weight: 'thick', fill: 'solid' } });
  });

  it('ignores other boards and stale snapshots', () => {
    const store = setup();
    store.applyCommit({ ...remote(2), channelId: 'wrong' });
    store.hydrate({ seq: 0, objects: [] });
    expect(store.getSeq()).toBe(1);
    expect(store.getObject('a')).toEqual(rect());
  });
});

describe('acknowledged local history', () => {
  it('undoes and redoes a gesture with conditional commands and no recursive entries', () => {
    const store = setup();
    const move = store.dispatch([update()], { label: 'Move' });
    ack(store, move, 2);
    const undo = store.undo()!;
    expect(store.getObject('a')?.x).toBe(0);
    expect(store.getPendingOperations()[0].command.changes).toEqual([update('a', 2, 0)]);
    ack(store, undo, 3);
    expect(store.canUndo()).toBe(false);
    const redo = store.redo()!;
    expect(store.getPendingOperations()[0].command.changes).toEqual([update('a', 3, 10)]);
    ack(store, redo, 4);
    expect(store.getObject('a')).toMatchObject({ x: 10, version: 4 });
    expect(store.canUndo()).toBe(true);
    expect(store.canRedo()).toBe(false);
  });

  it('walks multiple gestures on the same object backwards and forwards through own inverse acknowledgements', () => {
    const store = setup();
    const first = store.dispatch([update()]);
    const second = store.dispatch([update('a', 1, 20)]);
    ack(store, first, 2);
    ack(store, second, 3);
    const undoSecond = store.undo()!;
    ack(store, undoSecond, 4);
    expect(store.getObject('a')?.x).toBe(10);
    const undoFirst = store.undo()!;
    expect(undoFirst).not.toBeNull();
    ack(store, undoFirst, 5);
    expect(store.getObject('a')?.x).toBe(0);
    const redoFirst = store.redo()!;
    ack(store, redoFirst, 6);
    expect(store.getObject('a')?.x).toBe(10);
    const redoSecond = store.redo()!;
    expect(redoSecond).not.toBeNull();
    ack(store, redoSecond, 7);
    expect(store.getObject('a')?.x).toBe(20);
    expect(store.canRedo()).toBe(false);
  });

  it('advances only restored ids in multi-object history lineage', () => {
    const store = setup([rect(), rect('b')]);
    const first = store.dispatch([update(), update('b')]);
    ack(store, first, 2);
    const second = store.dispatch([update('a', 2, 20)]);
    ack(store, second, 3);
    const undoSecond = store.undo()!;
    ack(store, undoSecond, 4);
    const undoFirst = store.undo()!;
    expect(store.getPendingOperations()[0].command.changes).toEqual([update('a', 4, 0), update('b', 2, 0)]);
    ack(store, undoFirst, 5);
    expect(store.getObject('a')?.x).toBe(0);
    expect(store.getObject('b')?.x).toBe(0);
  });

  it('preserves inverse lineage when a fresh gesture clears redo while undo is in flight', () => {
    const store = setup([rect(), rect('b')]);
    const first = store.dispatch([update()]);
    ack(store, first, 2);
    const second = store.dispatch([update('a', 2, 20)]);
    ack(store, second, 3);
    const undoSecond = store.undo()!;
    const other = store.dispatch([update('b')]);
    ack(store, undoSecond, 4);
    ack(store, other, 5);
    const undoOther = store.undo()!;
    ack(store, undoOther, 6);
    const undoFirst = store.undo()!;
    expect(undoFirst).not.toBeNull();
    ack(store, undoFirst, 7);
    expect(store.getObject('a')?.x).toBe(0);
  });

  it('can restore a locally deleted object originally created by another member', () => {
    const store = setup([{ ...rect(), createdBy: 'other' }]);
    const deleted = store.dispatch([{ id: 'a', action: 'delete', expectedVersion: 1 }]);
    ack(store, deleted, 2);
    const undo = store.undo()!;
    expect(undo).not.toBeNull();
    expect(store.getObject('a')?.createdBy).toBe('me');
    expect(store.getPendingOperations()[0].command.changes[0]).toMatchObject({
      expectedVersion: 0, expectedSeq: 2, body: { id: 'a', version: 0, createdBy: 'me' },
    });
    ack(store, undo, 3);
  });

  it('skips undo after a remote edit, including undo of create', () => {
    for (const create of [false, true]) {
      const store = setup(create ? [] : [rect()], create ? 0 : 1);
      const opId = store.dispatch(create ? [{ id: 'a', action: 'create', expectedVersion: 0, body: rect('a', 0) }] : [update()]);
      ack(store, opId, create ? 1 : 2);
      store.applyCommit(remote(create ? 2 : 3, 'a', 50));
      expect(store.undo()).toBeNull();
      expect(store.getPendingOperations()).toEqual([]);
      expect(store.getObject('a')?.x).toBe(50);
      expect(store.getHistoryReport()?.skipped).toEqual([{ id: 'a', reason: 'changed' }]);
    }
  });

  it('skips only conflicting objects within one gesture', () => {
    const store = setup([rect(), rect('b')]);
    const move = store.dispatch([update(), update('b')]);
    ack(store, move, 2);
    store.applyCommit(remote(3, 'a', 80));
    const undo = store.undo()!;
    expect(store.getPendingOperations()[0].command.changes).toEqual([update('b', 2, 0)]);
    expect(store.getHistoryReport()?.skipped).toEqual([{ id: 'a', reason: 'changed' }]);
    ack(store, undo, 4);
    const redo = store.redo()!;
    expect(store.getPendingOperations()[0].command.changes).toEqual([update('b', 4, 10)]);
    ack(store, redo, 5);
    expect(store.getObject('a')?.x).toBe(80);
  });

  it('reserves an undo opId while pending but does not queue/send it until ack and integration', () => {
    const store = setup();
    const move = store.dispatch([update()]);
    expect(store.canUndo()).toBe(true);
    const undo = store.undo()!;
    expect(undo).not.toBeNull();
    expect(store.getPendingOperations().map(item => item.command.opId)).toEqual([move]);
    expect(store.canSend(undo)).toBe(false);
    ack(store, move, 3);
    expect(store.getPendingOperations()).toHaveLength(1);
    store.applyCommit({ ...remote(2, 'b'), changes: [] });
    expect(store.getPendingOperations().map(item => item.command.opId)).toEqual([undo]);
    expect(store.getPendingOperations()[0].command.changes).toEqual([update('a', 3, 0)]);
    expect(store.getObject('a')?.x).toBe(0);
  });

  it('cancels a waiting undo when its predecessor is rejected', () => {
    const store = setup();
    const move = store.dispatch([update()]);
    store.undo();
    store.applyReject({ opId: move, code: 'invalid', error: 'no', current: [] });
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('redo waits for the undo acknowledgement and skips intervening remote work', () => {
    const store = setup();
    const move = store.dispatch([update()]);
    ack(store, move, 2);
    const undo = store.undo()!;
    const redo = store.redo()!;
    expect(store.getPendingOperations().map(item => item.command.opId)).toEqual([undo]);
    store.applyCommit(remote(4, 'a', 80));
    ack(store, undo, 3);
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.getHistoryReport()).toMatchObject({ opId: redo, direction: 'redo', skipped: [{ id: 'a', reason: 'changed' }] });
    expect(store.getObject('a')?.x).toBe(80);
  });

  it('undoes deletes only with a proven unchanged tombstone; refetch invalidates absence history', () => {
    for (const refetch of [false, true]) {
      const store = setup();
      const deleted = store.dispatch([{ id: 'a', action: 'delete', expectedVersion: 1 }]);
      ack(store, deleted, 2);
      if (refetch) store.hydrate({ seq: 2, objects: [] });
      const undo = store.undo();
      if (refetch) {
        expect(undo).toBeNull();
        expect(store.getHistoryReport()?.skipped).toEqual([{ id: 'a', reason: 'unproven-absence' }]);
      } else {
        expect(undo).not.toBeNull();
        expect(store.getObject('a')).toEqual(rect('a', 0));
        ack(store, undo!, 3);
        expect(store.getObject('a')?.version).toBe(3);
      }
    }
  });

  it('guards deletion undo at the latest contiguous seq and never retargets after a guard rejection', () => {
    const store = setup([rect(), rect('b')]);
    const deleted = store.dispatch([{ id: 'a', action: 'delete', expectedVersion: 1 }]);
    ack(store, deleted, 2);
    store.applyCommit(remote(3, 'b', 30)); // known unrelated change is safe
    const undo = store.undo()!;
    const command = store.getPendingOperations()[0].command;
    expect(command.changes[0]).toMatchObject({ action: 'create', expectedVersion: 0, expectedSeq: 3 });
    store.markSending(undo);
    // An unseen recreate/delete at 4/5 is indistinguishable from absence locally,
    // but the server rejects expectedSeq=3 at seq 5.
    store.applyReject({ opId: undo, code: 'conflict', seq: 5, error: 'guard failed', current: [] });
    expect(store.getObject('a')).toBeUndefined();
    expect(store.getPendingOperations()).toEqual([]);
    expect(store.undo()).toBeNull();
    expect(store.getHistoryReport()?.skipped).toEqual([{ id: 'a', reason: 'unproven-absence' }]);
    expect(command.changes[0]).toMatchObject({ expectedSeq: 3 });
  });

  it('does not replay an incompatible guarded create after refetch', () => {
    const store = setup([], 2);
    const opId = store.dispatch([{ id: 'a', action: 'create', expectedVersion: 0, expectedSeq: 2, body: rect('a', 0) }]);
    const command = store.getPendingOperations()[0].command;
    store.markSending(opId);
    store.hydrate({ seq: 4, objects: [] });
    expect(store.getObject('a')).toBeUndefined();
    expect(store.getPendingOperations()[0].command).toBe(command);
  });

  it('never recreates over another person’s object or a changed deletion tombstone', () => {
    for (const deleteAgain of [false, true]) {
      const store = setup();
      const deleted = store.dispatch([{ id: 'a', action: 'delete', expectedVersion: 1 }]);
      ack(store, deleted, 2);
      store.applyCommit({ ...remote(3), changes: [{ id: 'a', action: 'create', body: rect('a', 3, 99), version: 3 }] });
      if (deleteAgain) store.applyCommit({ ...remote(4), changes: [{ id: 'a', action: 'delete', version: 4 }] });
      expect(store.undo()).toBeNull();
      expect(store.getPendingOperations()).toEqual([]);
    }
  });

  it('a new action clears redo; recordHistory false does not create history', () => {
    const store = setup([rect(), rect('b')]);
    const move = store.dispatch([update()]);
    ack(store, move, 2);
    const undo = store.undo()!;
    ack(store, undo, 3);
    expect(store.canRedo()).toBe(true);
    store.dispatch([update('b')]);
    expect(store.canRedo()).toBe(false);
    const noHistory = setup();
    noHistory.dispatch([update()], { recordHistory: false });
    expect(noHistory.canUndo()).toBe(false);
  });

  it('caps one entry per gesture and does not record remote operations', () => {
    const store = setup([rect(), rect('b')], 1, 1);
    const first = store.dispatch([update()]);
    ack(store, first, 2);
    const second = store.dispatch([update('b')]);
    ack(store, second, 3);
    const undo = store.undo()!;
    ack(store, undo, 4);
    expect(store.canUndo()).toBe(false);
    store.applyCommit(remote(5));
    expect(store.canUndo()).toBe(false);
  });

  it('restores a rejected undo entry instead of offering a phantom redo', () => {
    const store = setup();
    const move = store.dispatch([update()]);
    ack(store, move, 2);
    const undo = store.undo()!;
    store.applyReject({ opId: undo, code: 'limit', error: 'try later', current: [] });
    expect(store.canRedo()).toBe(false);
    expect(store.canUndo()).toBe(true);
    expect(store.getObject('a')?.x).toBe(10);
  });
});
