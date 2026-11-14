/**
 * Wiring regression: the network path builds its adapter from the store's own
 * identities (last week's bug was an adapter acting as a different user than the
 * store stamps, which rejected and removed every new object).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectBoard, createBoardResources } from './localBoard';
import type { BoardConnection } from './localBoard';
import { createNetworkAdapter } from './sync/networkAdapter';
import { createImageIngest } from './assets/ingest';

vi.mock('./assets/ingest', async importOriginal => {
  const original = await importOriginal<typeof import('./assets/ingest')>();
  return { createImageIngest: vi.fn(original.createImageIngest) };
});

vi.mock('./sync/networkAdapter', async () => {
  const { createLocalAdapter } = await import('./sync/localAdapter');
  return {
    createNetworkAdapter: vi.fn((options: { boardId: string; userId: string }) =>
      createLocalAdapter({ boardId: options.boardId, userId: options.userId })),
  };
});

const USER = 'a1b2c3d4-0000-4000-8000-0000000000aa';
const CHANNEL = 'c0ffee00-0000-4000-8000-0000000000bb';

let connection: BoardConnection | undefined;
afterEach(() => { connection?.dispose(); connection = undefined; vi.clearAllMocks(); });

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

function setup() {
  const element = document.createElement('div');
  element.setAttribute('data-wb-viewport', '');
  document.body.appendChild(element);
  const resources = createBoardResources({ boardId: CHANNEL, userId: USER });
  const resolveName = (id: string) => `name:${id}`;
  connection = connectBoard(resources, { element, resolveName });
  return { element, resources, resolveName };
}

describe('connectBoard', () => {
  it('gives the adapter the SAME board and user as the store, plus the name resolver', async () => {
    const { resources, resolveName } = setup();
    expect(resources.identity).toEqual({ boardId: CHANNEL, userId: USER });
    expect(createNetworkAdapter).toHaveBeenCalledExactlyOnceWith({ boardId: CHANNEL, userId: USER, resolveName });
    await connection!.started;
  });

  it('builds the image ingest from the SAME adapter, store, session, runtime and user, and exposes it', async () => {
    const { resources } = setup();
    await connection!.started;
    expect(createImageIngest).toHaveBeenCalledOnce();
    const options = vi.mocked(createImageIngest).mock.calls[0][0];
    expect(options.adapter).toBe(connection!.adapter);
    expect(options.store).toBe(resources.store);
    expect(options.session).toBe(resources.session);
    expect(options.runtime).toBe(resources.runtime);
    expect(options.userId).toBe(resources.identity.userId);
    expect(typeof connection!.ingest.addFiles).toBe('function');
  });

  it('routes pasted image files from the viewport into the ingest, and the I shortcut to onRequestImage', async () => {
    const element = document.createElement('div');
    element.setAttribute('data-wb-viewport', '');
    document.body.appendChild(element);
    const resources = createBoardResources({ boardId: CHANNEL, userId: USER });
    const onRequestImage = vi.fn();
    connection = connectBoard(resources, { element, onRequestImage });
    const addFiles = vi.spyOn(connection.ingest, 'addFiles').mockResolvedValue();
    await connection.started;
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }));
    expect(onRequestImage).toHaveBeenCalledOnce();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    element.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { files: [file], getData: () => '' },
    }));
    expect(addFiles).toHaveBeenCalledExactlyOnceWith([file], undefined);
  });

  it('what the store creates is accepted by an adapter built from that identity (nothing is rejected away)', async () => {
    const { element, resources } = setup();
    await connection!.started;
    resources.session.setTool('pen');
    const fire = (type: string, x: number, y: number) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse',
    }));
    fire('pointerdown', 10, 10); fire('pointermove', 40, 30); fire('pointermove', 90, 60); fire('pointerup', 90, 60);
    await flush();
    expect(resources.store.getObjectIds()).toHaveLength(1);
    expect(resources.notices.getLatest()).toBeNull();
  });

  it('is idempotent to dispose and leaves the adapter offline', async () => {
    setup();
    await connection!.started;
    connection!.dispose();
    connection!.dispose();
    expect(connection!.adapter.getStatus()).toBe('offline');
  });
});
