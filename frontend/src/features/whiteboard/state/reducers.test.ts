import { describe, expect, it } from 'vitest';
import type { Change, Commit, PendingOperation, RectObject } from '../contract';
import { applyChange, applyServerCommit, computeVisibleState, invertChange } from './reducers';

const object: RectObject = Object.freeze({
  id: 'a', kind: 'rect', version: 7, createdBy: 'me', rank: '1:a', x: 1, y: 2, w: 3, h: 4,
  style: Object.freeze({ colour: 'ink', weight: 'thin', fill: 'none' }),
});

describe('immutable reducers', () => {
  it('applies shallow absolute patches without mutating the source or incrementing versions', () => {
    const objects = new Map([['a', object]]);
    const change: Change = {
      id: 'a', action: 'update', expectedVersion: 7,
      patch: { x: 10, style: { colour: 'red', weight: 'thick', fill: 'solid' } },
    };
    const next = applyChange(objects, change);
    expect(objects.get('a')).toBe(object);
    expect(next.get('a')).toMatchObject({ x: 10, version: 7, style: { colour: 'red', weight: 'thick', fill: 'solid' } });
    expect(invertChange(objects, change)).toEqual({
      id: 'a', action: 'update', expectedVersion: 7, patch: { x: 1, style: object.style },
    });
    expect(applyChange(next, invertChange(objects, change)!)).toEqual(objects);
  });

  it('inverts creates/deletes and treats missing updates/deletes as no-ops', () => {
    const objects = new Map([['a', object]]);
    const deletion: Change = { id: 'a', action: 'delete', expectedVersion: 7 };
    expect(applyChange(objects, deletion).size).toBe(0);
    expect(invertChange(objects, deletion)).toEqual({ id: 'a', action: 'create', expectedVersion: 0, body: { ...object, version: 0 } });
    const creation: Change = { id: 'b', action: 'create', expectedVersion: 0, body: { ...object, id: 'b', version: 0 } };
    expect(invertChange(objects, creation)).toEqual({ id: 'b', action: 'delete', expectedVersion: 0 });
    expect(applyChange(objects, { id: 'b', action: 'delete', expectedVersion: 1 })).toBe(objects);
    expect(invertChange(objects, { id: 'b', action: 'delete', expectedVersion: 1 })).toBeNull();
  });

  it('uses commit.seq for versions, respects newer reconciliation and tombstones', () => {
    const initial = { objects: new Map([['a', object]]), versions: new Map([['a', 7], ['gone', 8]]) };
    const commit: Commit = {
      channelId: 'board', userId: 'other', opId: 'op', seq: 8,
      changes: [
        { id: 'a', action: 'update', version: 8, patch: { y: 20 } },
        { id: 'gone', action: 'create', version: 8, body: { ...object, id: 'gone', version: 8 } },
      ],
    };
    const next = applyServerCommit(initial, commit);
    expect(next.objects.get('a')).toMatchObject({ y: 20, version: 8 });
    expect(next.objects.has('gone')).toBe(false);
    expect(initial.objects.get('a')).toBe(object);
    const duplicate = applyServerCommit(next, commit);
    expect(duplicate.objects).toBe(next.objects);
    expect(duplicate.versions).toBe(next.versions);
    const deletion = applyServerCommit(next, {
      ...commit, seq: 9, changes: [{ id: 'a', action: 'delete', version: 9 }],
    });
    expect(deletion.versions.get('a')).toBe(9);
    expect(deletion.objects.has('a')).toBe(false);
    expect(applyServerCommit(deletion, commit).objects.has('a')).toBe(false);
  });

  it('replays pending in dispatch order and skips an incompatible command atomically', () => {
    const canonical = new Map([['a', object]]);
    const pending: PendingOperation[] = [
      { command: { opId: 'first', changes: [{ id: 'a', action: 'update', expectedVersion: 7, patch: { x: 10 } }] }, status: 'queued', attempts: 0 },
      { command: { opId: 'second', changes: [{ id: 'a', action: 'update', expectedVersion: 0, patch: { x: 20 } }] }, status: 'queued', attempts: 0 },
      { command: { opId: 'invalid', changes: [
        { id: 'a', action: 'update', expectedVersion: 7, patch: { x: 30 } },
        { id: 'missing', action: 'delete', expectedVersion: 1 },
      ] }, status: 'queued', attempts: 0 },
    ];
    expect(computeVisibleState(canonical, pending).get('a')).toMatchObject({ x: 20, version: 7 });
    expect(canonical.get('a')).toBe(object);
  });
});
