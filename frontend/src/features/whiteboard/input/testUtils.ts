import { vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type {
  BoardObject, Camera, CommandResult, Point, Runtime, RuntimePreview, Snapshot, Unsubscribe,
} from '../contract';
import { clampZoom, screenToWorld, worldToScreen } from '../core';
import { createBoardStore, createSessionStore } from '../state';
import type { ManagedBoardStore, SessionStore } from '../state';
import { EMPTY_PREVIEW } from './objects';
import type { PointerSample, ToolContext } from './types';

/** Test-only Runtime: synchronous, records every preview write. */
export interface FakeRuntime extends Runtime {
  readonly previews: RuntimePreview[];
}

export function createFakeRuntime(initial: Partial<Camera> = {}): FakeRuntime {
  let camera: Camera = { x: 0, y: 0, zoom: 1, ...initial };
  let preview: RuntimePreview = EMPTY_PREVIEW;
  const previews: RuntimePreview[] = [];
  const cameraListeners = new Set<(camera: Camera) => void>();
  const previewListeners = new Set<(preview: RuntimePreview) => void>();
  function sub<T>(set: Set<T>, listener: T): Unsubscribe {
    set.add(listener);
    return () => set.delete(listener);
  }
  return {
    previews,
    getCamera: () => camera,
    setCamera(next) {
      camera = { ...next, zoom: clampZoom(next.zoom) };
      for (const listener of cameraListeners) listener(camera);
    },
    subscribeCamera: listener => sub(cameraListeners, listener),
    screenToWorld: (screen: Point) => screenToWorld(screen, camera),
    worldToScreen: (world: Point) => worldToScreen(world, camera),
    getPreview: () => preview,
    setPreview(next) {
      preview = next;
      previews.push(next);
      for (const listener of previewListeners) listener(preview);
    },
    subscribePreview: listener => sub(previewListeners, listener),
  };
}

export const USER = '00000000-0000-4000-8000-000000000001';
export const BOARD = '00000000-0000-4000-8000-0000000000b0';

export interface Harness {
  readonly store: ManagedBoardStore;
  readonly session: SessionStore;
  readonly runtime: FakeRuntime;
  readonly ctx: ToolContext;
  readonly dispatch: MockInstance<ManagedBoardStore['dispatch']>;
  /** Acknowledge every pending operation, as a server would (enables undo). */
  ackAll(): void;
}

export function createHarness(
  objects: readonly BoardObject[] = [],
  camera: Partial<Camera> = {},
): Harness {
  let idCounter = 0;
  let opCounter = 0;
  const store = createBoardStore({
    boardId: BOARD, userId: USER,
    createOpId: () => `00000000-0000-4000-9000-${String(++opCounter).padStart(12, '0')}`,
  });
  const seq = objects.reduce((max, object) => Math.max(max, object.version), 0);
  const snapshot: Snapshot = { seq, objects };
  store.hydrate(snapshot);
  const session = createSessionStore();
  const runtime = createFakeRuntime(camera);
  const ctx: ToolContext = {
    store, session, runtime, userId: USER,
    newId: () => `10000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
  };
  const dispatch = vi.spyOn(store, 'dispatch');
  return {
    store, session, runtime, ctx, dispatch,
    ackAll() {
      for (const operation of [...store.getPendingOperations()]) {
        if (operation.status === 'acknowledged') continue;
        const seqNext = store.getSeq() + 1;
        const result: CommandResult = {
          seq: seqNext,
          changes: operation.command.changes.map(change => ({ id: change.id, action: change.action, version: seqNext })),
        };
        store.acknowledge(operation.command.opId, result);
      }
    },
  };
}

export function sample(world: Point, options: Partial<PointerSample> = {}, zoom = 1): PointerSample {
  return {
    screen: { x: world.x * zoom, y: world.y * zoom },
    world,
    pressure: 0.5,
    shiftKey: false,
    altKey: false,
    modKey: false,
    ...options,
  };
}

let fixtureCounter = 0;
function fixtureId(): string {
  return `20000000-0000-4000-8000-${String(++fixtureCounter).padStart(12, '0')}`;
}

export function rectObject(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: fixtureId(), kind: 'rect', rank: '1:a0', version: 1, createdBy: USER,
    x: 0, y: 0, w: 100, h: 100, style: { colour: 'ink', weight: 'thin', fill: 'none' },
    ...overrides,
  } as BoardObject;
}

export function frameObject(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: fixtureId(), kind: 'frame', rank: '0:a0', version: 1, createdBy: USER,
    x: 0, y: 0, w: 400, h: 300, label: 'F', style: { colour: 'gray', weight: 'thin' },
    ...overrides,
  } as BoardObject;
}

export function textObject(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: fixtureId(), kind: 'text', rank: '1:a0', version: 1, createdBy: USER,
    x: 0, y: 0, w: 200, h: 34, text: 'hi',
    style: { colour: 'ink', size: 'M', font: 'app', bold: false, italic: false, align: 'left' },
    ...overrides,
  } as BoardObject;
}

export function lineObject(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: fixtureId(), kind: 'arrow', rank: '1:a0', version: 1, createdBy: USER,
    x: 0, y: 0, w: 100, h: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
    style: { colour: 'ink', weight: 'thin' },
    ...overrides,
  } as BoardObject;
}

export function imageObject(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    id: fixtureId(), kind: 'image', rank: '1:a0', version: 1, createdBy: USER,
    x: 0, y: 0, w: 100, h: 50, assetId: fixtureId(), url: '/uploads/board-assets/a.png',
    width: 200, height: 100, crop: { x: 0, y: 0, w: 1, h: 1 }, pixelated: false,
    ...overrides,
  } as BoardObject;
}
