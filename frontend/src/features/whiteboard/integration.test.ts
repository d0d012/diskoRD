/**
 * Integration: the REAL store, session, runtime, local adapter, sync coordinator
 * and input controller, composed by connectLocalBoard exactly as
 * WhiteboardChannel composes them, driven by DOM pointer/keyboard events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { MAX_CHANGES_PER_COMMAND, TEXT_SIZE_WORLD_UNITS } from './contract';
import type { BoardObject, ObjectKind, RectObject, StickyObject, TextObject } from './contract';
import { TEXT_LINE_HEIGHT, setSharedTextMeasurerForTests } from './editing/measure';
import { continueCheckboxOnEnter, rankBetweenMany, resolveStickyToneCss } from './core';
import { connectLocalBoard, createBoardResources } from './localBoard';
import type { BoardResources, LocalBoardConnection } from './localBoard';

const USER = 'a1b2c3d4-0000-4000-8000-0000000000aa';
const OTHER_USER = 'a1b2c3d4-0000-4000-8000-0000000000ff';
const CHANNEL = 'c0ffee00-0000-4000-8000-0000000000bb';

let element: HTMLDivElement;
let board: BoardResources;
let connection: LocalBoardConnection;
let warn: MockInstance<typeof console.warn>;

/** Lets the local adapter's zero-delay tasks, microtasks and the coordinator pump run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

async function setup(options: { objects?: readonly BoardObject[]; adapterUserId?: string } = {}): Promise<void> {
  element = document.createElement('div');
  element.className = 'wb-root';
  element.setAttribute('data-wb-viewport', '');
  document.body.appendChild(element);
  board = createBoardResources({ boardId: CHANNEL, userId: USER });
  const objects = options.objects ?? [];
  const seq = objects.reduce((max, object) => Math.max(max, object.version), 0);
  connection = connectLocalBoard(board, {
    boardId: CHANNEL, userId: options.adapterUserId ?? USER, element,
    snapshot: { seq, objects },
  });
  await connection.started;
}

function pointer(type: string, x: number, y: number, target: Element = element, init: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse', ...init,
  }));
}

function drag(points: readonly (readonly [number, number])[], target: Element = element): void {
  const [first, ...rest] = points;
  pointer('pointerdown', first[0], first[1], target);
  for (const [x, y] of rest.slice(0, -1)) pointer('pointermove', x, y);
  const last = rest[rest.length - 1] ?? first;
  pointer('pointermove', last[0], last[1]);
  pointer('pointerup', last[0], last[1]);
}

function key(keyName: string, init: KeyboardEventInit = {}): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init }));
}
const undo = () => key('z', { ctrlKey: true });
const redo = () => key('z', { ctrlKey: true, shiftKey: true });

function objects(): readonly BoardObject[] {
  return board.store.getObjectsInRank();
}
function only(kind?: ObjectKind): BoardObject {
  const list = kind ? objects().filter(object => object.kind === kind) : objects();
  expect(list).toHaveLength(1);
  return list[0];
}
/** Acknowledged = no pending work and the store's object carries a server seq. */
function expectSettled(): void {
  expect(board.store.getPendingOperations()).toEqual([]);
  for (const object of objects()) expect(object.version).toBeGreaterThan(0);
}
/** The local server's (authority's) state, read without a GET. */
function serverObjects(): readonly BoardObject[] {
  return connection.adapter.peekSnapshot().objects;
}

beforeEach(() => {
  document.body.innerHTML = '';
  warn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  connection?.dispose();
  setSharedTextMeasurerForTests(null);
  warn.mockRestore();
});

describe('local board integration: creation persists through the real coordinator', () => {
  it('a pen stroke survives pointer-up and is acknowledged by the local server', async () => {
    await setup();
    board.session.setTool('pen');
    drag([[10, 10], [40, 30], [80, 60], [120, 70]]);
    expect(only('stroke').version).toBe(0); // optimistic
    await flush();
    const stroke = only('stroke');
    expect(stroke).toMatchObject({ kind: 'stroke', createdBy: USER, version: 1 });
    expectSettled();
    expect(serverObjects().map(object => object.id)).toEqual([stroke.id]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['sticky', [[100, 100]]],
    ['rect', [[10, 10], [60, 40], [110, 60]]],
    ['ellipse', [[10, 10], [110, 60]]],
    ['line', [[10, 10], [200, 10]]],
    ['arrow', [[10, 10], [200, 80]]],
    ['text', [[50, 50]]],
    ['frame', [[0, 0], [300, 200]]],
  ] as const)('creates a %s that stays after the ack', async (tool, points) => {
    await setup();
    board.session.setTool(tool);
    drag(points);
    await flush();
    const object = only(tool);
    expect(object.createdBy).toBe(USER);
    expectSettled();
    expect(serverObjects()).toEqual([object]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('local board integration: edit, delete, undo and redo', () => {
  async function drawRect(): Promise<RectObject> {
    board.session.setTool('rect');
    drag([[10, 10], [60, 40], [110, 60]]);
    await flush();
    return only('rect') as RectObject;
  }

  it('creates, then undoes and redoes the creation', async () => {
    await setup();
    const rect = await drawRect();
    undo();
    await flush();
    expect(objects()).toEqual([]);
    expect(serverObjects()).toEqual([]);
    redo();
    await flush();
    expect(only('rect')).toMatchObject({ id: rect.id, x: rect.x, w: rect.w });
    expectSettled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('Ctrl+Z immediately after drawing (before the ack) undoes once the ack arrives', async () => {
    await setup();
    board.session.setTool('pen');
    drag([[10, 10], [40, 30], [80, 60]]);
    undo(); // queued: the stroke's create is not acknowledged yet
    expect(board.store.canUndo()).toBe(false);
    await flush();
    expect(objects()).toEqual([]);
    expectSettled();
    expect(serverObjects()).toEqual([]);
    redo();
    await flush();
    expect(only('stroke').version).toBeGreaterThan(0);
  });

  it('moves a selected object; undo and redo the move', async () => {
    await setup();
    const rect = await drawRect();
    board.session.setTool('select');
    drag([[50, 30], [80, 50], [150, 130]]);
    await flush();
    expect(only('rect')).toMatchObject({ x: rect.x + 100, y: rect.y + 100 });
    expectSettled();
    undo();
    await flush();
    expect(only('rect')).toMatchObject({ x: rect.x, y: rect.y });
    redo();
    await flush();
    expect(only('rect')).toMatchObject({ x: rect.x + 100, y: rect.y + 100 });
    expect(serverObjects()[0]).toMatchObject({ x: rect.x + 100 });
    expectSettled();
  });

  it('resizes through a selection handle; undo and redo the resize', async () => {
    await setup();
    const rect = await drawRect();
    board.session.setSelectedIds([rect.id]);
    const handle = document.createElement('div');
    handle.dataset.wbHandle = 'se';
    element.appendChild(handle);
    board.session.setTool('select');
    pointer('pointerdown', rect.x + rect.w, rect.y + rect.h, handle);
    pointer('pointermove', 200, 160);
    pointer('pointerup', 260, 210);
    await flush();
    expect(only('rect')).toMatchObject({ x: rect.x, y: rect.y, w: 250, h: 200 });
    expectSettled();
    undo();
    await flush();
    expect(only('rect')).toMatchObject({ w: rect.w, h: rect.h });
    redo();
    await flush();
    expect(only('rect')).toMatchObject({ w: 250, h: 200 });
    expectSettled();
  });

  it('deletes the selection with the keyboard; undo re-creates it, redo deletes again', async () => {
    await setup();
    const rect = await drawRect();
    board.session.setSelectedIds([rect.id]);
    key('Delete');
    await flush();
    expect(objects()).toEqual([]);
    expect(serverObjects()).toEqual([]);
    undo();
    await flush();
    expect(only('rect')).toMatchObject({ id: rect.id, x: rect.x, createdBy: USER });
    expectSettled();
    redo();
    await flush();
    expect(objects()).toEqual([]);
    expectSettled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('undoes and redoes a whole sequence of different actions in order', async () => {
    await setup();
    board.session.setTool('pen');
    drag([[300, 300], [340, 330]]);
    await flush();
    const rect = await drawRect();
    board.session.setTool('select');
    drag([[50, 30], [90, 60]]);
    await flush();
    expect(objects()).toHaveLength(2);
    undo(); await flush();
    expect(board.store.getObject(rect.id)).toMatchObject({ x: rect.x });
    undo(); await flush();
    expect(board.store.getObject(rect.id)).toBeUndefined();
    undo(); await flush();
    expect(objects()).toEqual([]);
    redo(); await flush();
    redo(); await flush();
    redo(); await flush();
    expect(objects()).toHaveLength(2);
    expect(board.store.getObject(rect.id)).toMatchObject({ x: rect.x + 40 });
    expectSettled();
  });
});

describe('local board integration: text height', () => {
  const oneLine = Math.ceil(TEXT_SIZE_WORLD_UNITS.M * TEXT_LINE_HEIGHT);

  it('a new text object persists the editor one-line height', async () => {
    await setup();
    board.session.setTool('text');
    drag([[50, 50]]);
    await flush();
    expect(only('text').h).toBe(oneLine);
  });

  it('reflowing a text object (east handle) persists the re-measured height', async () => {
    // Deterministic wrap: 10 world units per character.
    setSharedTextMeasurerForTests(request =>
      Math.max(1, Math.ceil((request.text.length * 10) / request.width)) * request.fontSize * request.lineHeight);
    const text: TextObject = {
      id: '30000000-0000-4000-8000-000000000001', kind: 'text', rank: '1:a0', version: 1, createdBy: USER,
      x: 0, y: 0, w: 400, h: oneLine, text: 'x'.repeat(40),
      style: { colour: 'ink', size: 'M', font: 'app', bold: false, italic: false, align: 'left' },
    };
    await setup({ objects: [text] });
    board.session.setSelectedIds([text.id]);
    const handle = document.createElement('div');
    handle.dataset.wbHandle = 'e';
    element.appendChild(handle);
    pointer('pointerdown', 400, 10, handle);
    pointer('pointermove', 300, 10);
    pointer('pointerup', 100, 10);
    await flush();
    expect(only('text')).toMatchObject({ w: 100, h: oneLine * 4 });
    expectSettled();
  });
});

describe('local board integration: refused and rejected actions are visible', () => {
  const RANKS = rankBetweenMany(null, null, MAX_CHANGES_PER_COMMAND + 1, '1');

  it('a delete over MAX_CHANGES_PER_COMMAND is refused with a notice', async () => {
    const many: RectObject[] = Array.from({ length: MAX_CHANGES_PER_COMMAND + 1 }, (_, i) => ({
      id: `40000000-0000-4000-8000-${String(i).padStart(12, '0')}`, kind: 'rect', rank: RANKS[i],
      version: 1, createdBy: USER, x: i, y: 0, w: 10, h: 10, style: { colour: 'ink', weight: 'thin', fill: 'none' },
    }));
    await setup({ objects: many });
    key('a', { ctrlKey: true });
    key('Delete');
    await flush();
    expect(objects()).toHaveLength(many.length);
    expect(board.notices.getLatest()).toMatchObject({ kind: 'too-many-changes' });
    expect(board.notices.getLatest()!.message).toMatch(/Too many objects selected for one action/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('too-many-changes'));
  });

  it('a move over MAX_CHANGES_PER_COMMAND is refused with a notice', async () => {
    const many: RectObject[] = Array.from({ length: MAX_CHANGES_PER_COMMAND + 1 }, (_, i) => ({
      id: `50000000-0000-4000-8000-${String(i).padStart(12, '0')}`, kind: 'rect', rank: RANKS[i],
      version: 1, createdBy: USER, x: 0, y: 0, w: 100, h: 100, style: { colour: 'ink', weight: 'thin', fill: 'none' },
    }));
    await setup({ objects: many });
    key('a', { ctrlKey: true });
    drag([[50, 50], [80, 80], [150, 150]]);
    await flush();
    expect(objects().every(object => object.x === 0)).toBe(true);
    expect(board.notices.getLatest()).toMatchObject({ kind: 'too-many-changes' });
  });

  it('a server rejection is warned and surfaced (identity mismatch regression)', async () => {
    // The original bug: adapter actor !== store user, so every create was rejected.
    await setup({ adapterUserId: OTHER_USER });
    board.session.setTool('pen');
    drag([[10, 10], [40, 30]]);
    await flush();
    expect(objects()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/rejected.*Invalid create identity/), expect.anything());
    expect(board.notices.getLatest()).toMatchObject({ kind: 'rejected' });
  });
});

describe('local board integration: checkboxes, laser, sticky reactions, and custom hex colours', () => {
  it('clicking a checkbox on a sticky toggles [ ] <-> [x] and supports undo/redo', async () => {
    const sticky: StickyObject = {
      id: '60000000-0000-4000-8000-000000000001', kind: 'sticky', rank: '1:a0', version: 1, createdBy: USER,
      x: 20, y: 20, w: 200, h: 200, text: '- [ ] Buy milk\n- [x] Ship feature',
      style: { tone: 'yellow', font: 'handwriting' },
    };
    await setup({ objects: [sticky] });
    const objEl = document.createElement('div');
    objEl.dataset.wbObjectId = sticky.id;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.wbCheckboxLine = '0';
    cb.dataset.wbCheckboxObject = sticky.id;
    objEl.appendChild(cb);
    element.appendChild(objEl);

    pointer('pointerdown', 30, 30, cb);
    await flush();
    expect((only('sticky') as StickyObject).text).toBe('- [x] Buy milk\n- [x] Ship feature');
    expectSettled();

    // Double-clicking a checkbox must NOT open the inline TextEditor.
    cb.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0 }));
    expect(board.session.getState().editingId).toBeNull();

    undo();
    await flush();
    expect((only('sticky') as StickyObject).text).toBe('- [ ] Buy milk\n- [x] Ship feature');
    redo();
    await flush();
    expect((only('sticky') as StickyObject).text).toBe('- [x] Buy milk\n- [x] Ship feature');
  });

  it('continueCheckboxOnEnter inserts a new unchecked line or exits an empty item', () => {
    const next = continueCheckboxOnEnter('- [x] First item', 16, 16);
    expect(next).toEqual({ text: '- [x] First item\n- [ ] ', caret: 23 });
    const exit = continueCheckboxOnEnter('- [x] First item\n- [ ] ', 23, 23);
    expect(exit).toEqual({ text: '- [x] First item\n', caret: 17 });
  });

  it('toggles sticky emoji reactions with undo/redo even when sticky started without reactions', async () => {
    const sticky: StickyObject = {
      id: '60000000-0000-4000-8000-000000000002', kind: 'sticky', rank: '1:a0', version: 1, createdBy: USER,
      x: 20, y: 20, w: 200, h: 200, text: 'Vote here',
      style: { tone: 'yellow', font: 'handwriting' },
    };
    await setup({ objects: [sticky] });
    const objEl = document.createElement('div');
    objEl.dataset.wbObjectId = sticky.id;
    const reactionBtn = document.createElement('button');
    reactionBtn.dataset.wbReaction = '🔥';
    reactionBtn.dataset.wbReactionObject = sticky.id;
    objEl.appendChild(reactionBtn);
    element.appendChild(objEl);

    pointer('pointerdown', 30, 180, reactionBtn);
    await flush();
    expect((only('sticky') as StickyObject).reactions).toEqual({ '🔥': [USER] });
    expectSettled();

    undo();
    await flush();
    expect((only('sticky') as StickyObject).reactions).toEqual({});
    expectSettled();

    redo();
    await flush();
    expect((only('sticky') as StickyObject).reactions).toEqual({ '🔥': [USER] });
    expectSettled();

    // Duplicating a sticky note strips reactions from the copy.
    board.session.setSelectedIds([sticky.id]);
    key('d', { ctrlKey: true });
    await flush();
    const stickies = objects().filter((o): o is StickyObject => o.kind === 'sticky');
    expect(stickies).toHaveLength(2);
    const copy = stickies.find(o => o.id !== sticky.id)!;
    expect(copy.reactions).toBeUndefined();
    expectSettled();
  });

  it('draws objects with custom #RRGGBB hex colours and sticky tones', async () => {
    await setup();
    board.session.setStyleDefaults({
      shape: { colour: '#ff0055', weight: 'thin', fill: 'none' },
      sticky: { tone: '#1e293b', font: 'handwriting' },
    });
    board.session.setTool('rect');
    drag([[10, 10], [110, 80]]);
    await flush();
    expect((only('rect') as RectObject).style.colour).toBe('#ff0055');

    board.session.setTool('sticky');
    drag([[200, 200]]);
    await flush();
    expect((only('sticky') as StickyObject).style.tone).toBe('#1e293b');
    expect(resolveStickyToneCss('#1e293b').ink).toBe('#f8fafc');
    expectSettled();
  });

  it('laser tool (K) emits ephemeral preview without creating persistent board objects', async () => {
    await setup();
    key('k');
    expect(board.session.getState().tool).toBe('laser');
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 50, 60);
    expect(board.runtime.getPreview().objects).toHaveLength(1);
    expect(board.runtime.getPreview().objects[0]).toMatchObject({ kind: 'stroke', style: { colour: 'red', weight: 'thick' } });
    pointer('pointerup', 50, 60);
    await flush();
    expect(objects()).toEqual([]);
  });
});

