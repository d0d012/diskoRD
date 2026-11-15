import { describe, expect, it } from 'vitest';
import { MAX_OBJECTS_PER_USER, MAX_PLACEMENT_MARGIN } from '../contract';
import type { RectObject } from '../contract';
import { createBoardNotices, createBoardStore, createSessionStore } from '../state';
import { createChange, deleteChange, safeDispatch, updateChange } from './objects';

function makeRect(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 100,
  createdBy = 'me',
  version = 1,
): RectObject {
  return {
    id,
    kind: 'rect',
    rank: `1:${id}`,
    version,
    createdBy,
    x,
    y,
    w,
    h,
    style: { colour: 'ink', weight: 'thin', fill: 'none' },
  };
}

describe('safeDispatch quota and placement rules', () => {
  it('allows creating an object anywhere on an empty board (or when no untouched objects exist)', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    const notices = createBoardNotices();
    const far = makeRect('far', 5_000_000, -5_000_000, 100, 100, 'me', 0);
    const opId = safeDispatch(store, [createChange(far)], 'Create', notices.notify);
    expect(opId).not.toBeNull();
    expect(notices.getLatest()).toBeNull();
    expect(store.getObject('far')).toBeDefined();
  });

  it('allows creating and moving objects inside existing content expanded by MAX_PLACEMENT_MARGIN (50000)', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    store.hydrate({ seq: 1, objects: [makeRect('anchor', 0, 0, 100, 100)] });
    const notices = createBoardNotices();

    // Anchor is [0, 0]..[100, 100]; expanded C is [-50000, -50000]..[50100, 50100]
    const inside = makeRect('inside', 100 + MAX_PLACEMENT_MARGIN - 100, -MAX_PLACEMENT_MARGIN, 100, 100, 'me', 0);
    expect(safeDispatch(store, [createChange(inside)], 'Create inside', notices.notify)).not.toBeNull();
    expect(notices.getLatest()).toBeNull();
  });

  it('refuses creating an object outside existing content expanded by 50000 world units', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    store.hydrate({ seq: 1, objects: [makeRect('anchor', 0, 0, 100, 100)] });
    const notices = createBoardNotices();

    // Box extends to 50101 > 50100
    const outside = makeRect('outside', 50001, 0, 100, 100, 'me', 0);
    expect(safeDispatch(store, [createChange(outside)], 'Create outside', notices.notify)).toBeNull();
    expect(store.getObject('outside')).toBeUndefined();
    expect(notices.getLatest()?.message.toLowerCase()).toContain('too far from existing content');
  });

  it('refuses moving an object far away from untouched board objects', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 200, 200, 100, 100);
    store.hydrate({ seq: 1, objects: [a, b] });
    const notices = createBoardNotices();

    expect(safeDispatch(store, [updateChange(b, { x: 200_000, y: 200_000 })], 'Move far', notices.notify)).toBeNull();
    expect(store.getObject('b')?.x).toBe(200);
    expect(notices.getLatest()?.message.toLowerCase()).toContain('too far from existing content');
  });

  it('exempts deletes and non-geometry updates even for objects far outside other content', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    const anchor = makeRect('anchor', 0, 0, 100, 100);
    const outlier = makeRect('outlier', 500_000, 500_000, 100, 100);
    store.hydrate({ seq: 1, objects: [anchor, outlier] });
    const notices = createBoardNotices();

    // Non-geometry update on outlier is exempt
    const styleOp = safeDispatch(
      store,
      [updateChange(outlier, { style: { colour: 'red', weight: 'thick', fill: 'solid' } })],
      'Style',
      notices.notify,
    );
    expect(styleOp).not.toBeNull();
    expect(notices.getLatest()).toBeNull();

    // Delete of outlier is exempt
    const deleteOp = safeDispatch(store, [deleteChange(store.getObject('outlier')!)], 'Delete', notices.notify);
    expect(deleteOp).not.toBeNull();
    expect(store.getObject('outlier')).toBeUndefined();
    expect(notices.getLatest()).toBeNull();
  });

  it('refuses creating past MAX_OBJECTS_PER_USER (1500) for the current user while allowing deletes', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    const existing = Array.from({ length: MAX_OBJECTS_PER_USER }, (_, i) =>
      makeRect(`o-${i}`, (i % 40) * 20, Math.floor(i / 40) * 20, 10, 10, 'me', 1),
    );
    store.hydrate({ seq: 1, objects: existing });
    const notices = createBoardNotices();

    const extra = makeRect('extra', 0, 0, 10, 10, 'me', 0);
    expect(safeDispatch(store, [createChange(extra)], 'Create', notices.notify)).toBeNull();
    expect(store.getObject('extra')).toBeUndefined();
    expect(notices.getLatest()?.message.toLowerCase()).toContain('you can hold at most 1500 objects on a board');

    // Deleting own object is still allowed
    const del = safeDispatch(store, [deleteChange(existing[0])], 'Delete', notices.notify);
    expect(del).not.toBeNull();

    // Another user with < 1500 objects is not blocked by someone else's 1500 objects
    const otherStore = createBoardStore({ boardId: 'b', userId: 'other' });
    otherStore.hydrate({ seq: 1, objects: existing });
    const otherNotices = createBoardNotices();
    const otherCreate = makeRect('other-1', 0, 0, 10, 10, 'other', 0);
    expect(safeDispatch(otherStore, [createChange(otherCreate)], 'Create', otherNotices.notify)).not.toBeNull();
    expect(otherNotices.getLatest()).toBeNull();
  });

  it('exempts updates with geometry keys whose resulting values are unchanged', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    const outlier = makeRect('far', 500_000, -500_000);
    store.hydrate({ seq: 1, objects: [makeRect('anchor', 0, 0), outlier] });
    const notices = createBoardNotices();
    expect(safeDispatch(store, [updateChange(outlier, {
      x: outlier.x, y: outlier.y, w: outlier.w, h: outlier.h,
      style: { colour: 'red', weight: 'thin', fill: 'none' },
    })], 'Style', notices.notify)).not.toBeNull();
    expect(notices.getLatest()).toBeNull();
  });

  it('excludes every touched object from C, not just objects with geometry changes', () => {
    for (const action of ['delete', 'style'] as const) {
      const store = createBoardStore({ boardId: 'b', userId: 'me' });
      const far = makeRect('far', 500_000, 0);
      store.hydrate({ seq: 1, objects: [makeRect('anchor', 0, 0), far] });
      const touch = action === 'delete' ? deleteChange(far) : updateChange(far, { rank: '2:a' });
      expect(safeDispatch(store, [touch, createChange(makeRect('new', 500_100, 0, 100, 100, 'me', 0))])).toBeNull();
    }
  });

  it('allows relocating all content atomically when C is empty', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    const a = makeRect('a', 0, 0);
    const b = makeRect('b', 200, 0);
    store.hydrate({ seq: 1, objects: [a, b] });
    expect(safeDispatch(store, [
      updateChange(a, { x: 500_000 }), updateChange(b, { x: 500_200 }),
    ])).not.toBeNull();
  });

  it('uses raw geometry rather than rotated bounds and checks the resulting full extent', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    const anchor = { ...makeRect('anchor', 0, 0, 100, 100), rotation: 45 };
    const moving = makeRect('moving', 200, 200);
    store.hydrate({ seq: 1, objects: [anchor, moving] });
    expect(safeDispatch(store, [updateChange(moving, { x: MAX_PLACEMENT_MARGIN, y: -MAX_PLACEMENT_MARGIN })])).not.toBeNull();
    const current = store.getObject('moving')!;
    expect(safeDispatch(store, [updateChange(current, { w: 101 })])).toBeNull();
  });

  it('credits own deletes, but not other authors\' deletes, in an atomic replacement at quota', () => {
    for (const deleteOwn of [true, false]) {
      const store = createBoardStore({ boardId: 'b', userId: 'me' });
      const own = Array.from({ length: MAX_OBJECTS_PER_USER }, (_, i) => makeRect(`own-${i}`, 0, 0));
      const other = makeRect('other', 0, 0, 100, 100, 'someone-else');
      store.hydrate({ seq: 1, objects: [...own, other] });
      const result = safeDispatch(store, [
        deleteChange(deleteOwn ? own[0] : other), createChange(makeRect('replacement', 0, 0, 100, 100, 'me', 0)),
      ]);
      if (deleteOwn) expect(result).not.toBeNull();
      else expect(result).toBeNull();
    }
  });

  it('session hide and solo state is independent per board session', () => {
    const session = createSessionStore();
    expect(session.hasHiddenAuthors()).toBe(false);
    session.toggleHideAuthor('alice');
    expect(session.isAuthorHidden('alice')).toBe(true);
    expect(session.isAuthorHidden('bob')).toBe(false);
    session.toggleSoloAuthor('bob');
    expect(session.isAuthorHidden('bob')).toBe(false);
    expect(session.isAuthorHidden('carol')).toBe(true);
    session.showAllAuthors();
    expect(session.hasHiddenAuthors()).toBe(false);
    expect(session.isAuthorHidden('alice')).toBe(false);
  });
});
