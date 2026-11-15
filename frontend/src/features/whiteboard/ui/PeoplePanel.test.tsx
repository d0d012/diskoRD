import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardObject, Camera, RectObject, Runtime, StrokeObject } from '../contract';
import { fitToBounds, getBounds } from '../core';
import { objectAt } from '../input/objects';
import { selectAll } from '../input/shortcuts';
import type { ToolContext } from '../input/types';
import { createBoardNotices, createBoardStore, createSessionStore, filterVisibleObjects } from '../state';
import { useAuthStore } from '../../../stores/authStore';
import { useGuildStore } from '../../../stores/guildStore';
import { useUserStore } from '../../../stores/userStore';
import { PeoplePanel } from './PeoplePanel';
import { ZoomControl } from './ZoomControl';

function makeRuntime(): Runtime {
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  const listeners = new Set<(c: Camera) => void>();
  return {
    getCamera: () => camera,
    setCamera: c => {
      camera = c;
      listeners.forEach(l => l(c));
    },
    subscribeCamera: l => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    screenToWorld: p => ({ x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom }),
    worldToScreen: p => ({ x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y }),
    getPreview: () => ({ objects: [], hiddenIds: [], marquee: null }),
    setPreview: () => undefined,
    subscribePreview: () => () => undefined,
  };
}

function makeRect(
  id: string,
  createdBy: string,
  x: number,
  y: number,
  w = 300,
  h = 250,
): RectObject {
  return {
    id,
    kind: 'rect',
    rank: `1:${id}`,
    version: 1,
    createdBy,
    x,
    y,
    w,
    h,
    style: { colour: 'ink', weight: 'thin', fill: 'none' },
  };
}

function makeDot(id: string, createdBy: string, x: number, y: number): StrokeObject {
  return {
    id,
    kind: 'stroke',
    rank: `1:${id}`,
    version: 1,
    createdBy,
    x,
    y,
    w: 4,
    h: 4,
    points: [{ x: 0, y: 0, pressure: 0.5 }],
    style: { colour: 'ink', weight: 'thin' },
    preset: 'pen',
  };
}

describe('PeoplePanel', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
    useUserStore.setState({
      users: {
        'user-alice': { id: 'user-alice', username: 'alice', displayName: 'Alice Wonderland' },
        'user-bob': { id: 'user-bob', username: 'bob', displayName: 'Bob Builder' },
      },
    });
    useAuthStore.setState({
      user: { id: 'user-alice', username: 'alice', displayName: 'Alice Wonderland', status: 'online', createdAt: '' },
      accessToken: 'token',
    });
    useGuildStore.setState({
      guilds: [{ id: 'guild-1', name: 'Test Guild', ownerId: 'user-owner', createdAt: '' }],
      activeGuildId: 'guild-1',
      channels: { 'guild-1': [{ id: 'board-1', guildId: 'guild-1', name: 'wb', type: 'whiteboard', position: 0, createdAt: '' }] },
      activeChannelId: 'board-1',
    });
  });

  it('toggles open and lists authors sorted by object count descending with resolved names and fallback', () => {
    const store = createBoardStore({ boardId: 'board-1', userId: 'user-alice' });
    const unknownId = '99999999-0000-4000-8000-000000000099';
    store.hydrate({
      seq: 1,
      objects: [
        makeRect('a1', 'user-alice', 0, 0),
        makeRect('b1', 'user-bob', 0, 0),
        makeRect('b2', 'user-bob', 100, 0),
        makeRect('b3', 'user-bob', 200, 0),
        makeRect('u1', unknownId, 500, 0),
        makeRect('u2', unknownId, 600, 0),
      ],
    });
    const session = createSessionStore();
    const runtime = makeRuntime();

    render(<PeoplePanel store={store} session={session} runtime={runtime} />);
    expect(screen.queryByRole('region', { name: 'People panel' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'People on board' }));
    expect(screen.getByRole('region', { name: 'People panel' })).toBeTruthy();

    const authorItems = screen.getAllByRole('listitem').filter(el => el.hasAttribute('data-wb-author'));
    expect(authorItems.map(el => el.getAttribute('data-wb-author'))).toEqual([
      'user-bob',
      unknownId,
      'user-alice',
    ]);
    expect(screen.getByText('Bob Builder')).toBeTruthy();
    expect(screen.getByText('Unknown (999999)')).toBeTruthy();
    expect(screen.getByText(/Alice Wonderland/)).toBeTruthy();
  });

  it('moves the camera to fit a normal region when clicked, and cycles through scattered small marks', () => {
    const store = createBoardStore({ boardId: 'board-1', userId: 'user-alice' });
    const objects: BoardObject[] = [
      makeRect('r1', 'user-alice', 1000, 2000, 400, 300),
      makeDot('d1', 'user-alice', 10_000, 10_000),
      makeDot('d2', 'user-alice', -15_000, 20_000),
    ];
    store.hydrate({ seq: 1, objects });
    const session = createSessionStore();
    const runtime = makeRuntime();

    render(
      <div data-wb-viewport="">
        <PeoplePanel store={store} session={session} runtime={runtime} defaultOpen />
      </div>,
    );

    // Click normal region
    fireEvent.click(screen.getByRole('button', { name: /Region 1/i }));
    const expectedRegionCamera = fitToBounds({ x: 1000, y: 2000, w: 400, h: 300 }, { x: 0, y: 0, w: 800, h: 600 }, 64);
    expect(runtime.getCamera()).toEqual(expectedRegionCamera);

    // Click scattered small marks row twice to verify it cycles through each scattered mark
    const scatteredBtn = screen.getByRole('button', { name: /Scattered small marks \(2\)/i });
    fireEvent.click(scatteredBtn);
    const firstCam = runtime.getCamera();
    fireEvent.click(scatteredBtn);
    const secondCam = runtime.getCamera();
    expect(firstCam).not.toEqual(secondCam);
  });

  it('toggles hide and solo per author, filters hit-testing/selectAll/fit-to-content, and shows a persistent Show all indicator', () => {
    const store = createBoardStore({ boardId: 'board-1', userId: 'user-alice' });
    const aliceRect = makeRect('a1', 'user-alice', 0, 0, 200, 200);
    const bobRect = makeRect('b1', 'user-bob', 2000, 2000, 200, 200);
    store.hydrate({ seq: 1, objects: [aliceRect, bobRect] });
    const session = createSessionStore();
    const runtime = makeRuntime();

    const ctx: ToolContext = {
      store,
      session,
      runtime,
      userId: 'user-alice',
      newId: () => 'new-id',
    };

    render(
      <div data-wb-viewport="">
        <PeoplePanel store={store} session={session} runtime={runtime} defaultOpen />
        <ZoomControl store={store} session={session} runtime={runtime} />
      </div>,
    );

    // Initially no hidden indicator
    expect(screen.queryByRole('status', { name: 'Hidden objects indicator' })).toBeNull();

    // Hide Bob
    fireEvent.click(screen.getByRole('button', { name: 'Hide Bob Builder' }));
    expect(session.isAuthorHidden('user-bob')).toBe(true);
    expect(filterVisibleObjects(store.getObjectsInRank(), session).map(o => o.id)).toEqual(['a1']);

    // Hit testing at Bob's rect returns undefined while hidden
    expect(objectAt(ctx, { x: 2100, y: 2100 })).toBeUndefined();
    expect(objectAt(ctx, { x: 100, y: 100 })?.id).toBe('a1');

    // Select-all only selects visible objects
    selectAll(ctx);
    expect(session.getState().selectedIds).toEqual(['a1']);

    // Fit-to-content only fits visible objects (Alice's rect)
    fireEvent.click(screen.getByRole('button', { name: /Zoom to fit all/ }));
    // Zoom-to-fit includes the stroke extent, like the renderer's culling bounds.
    expect(runtime.getCamera()).toEqual(fitToBounds(getBounds(aliceRect), { x: 0, y: 0, w: 800, h: 600 }, 64));

    // Solo Bob -> only Bob is visible, Alice is hidden
    fireEvent.click(screen.getByRole('button', { name: 'Solo Bob Builder' }));
    expect(session.isAuthorHidden('user-bob')).toBe(false);
    expect(session.isAuthorHidden('user-alice')).toBe(true);
    expect(filterVisibleObjects(store.getObjectsInRank(), session).map(o => o.id)).toEqual(['b1']);

    // Persistent indicator is visible even if panel is closed, and one-click "Show all" restores all
    fireEvent.click(screen.getByRole('button', { name: 'People on board' }));
    expect(screen.queryByRole('region', { name: 'People panel' })).toBeNull();
    const indicator = screen.getByRole('status', { name: 'Hidden objects indicator' });
    expect(indicator).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(session.hasHiddenAuthors()).toBe(false);
    expect(filterVisibleObjects(store.getObjectsInRank(), session).map(o => o.id)).toEqual(['a1', 'b1']);
  });

  it('checks the board guild rather than an unrelated active guild', () => {
    useGuildStore.setState({
      activeGuildId: 'other-guild',
      guilds: [
        { id: 'guild-1', name: 'Board guild', ownerId: 'user-owner', createdAt: '' },
        { id: 'other-guild', name: 'Other guild', ownerId: 'user-alice', createdAt: '' },
      ],
    });
    const store = createBoardStore({ boardId: 'board-1', userId: 'user-alice' });
    store.hydrate({ seq: 1, objects: [makeRect('b1', 'user-bob', 0, 0)] });
    render(<PeoplePanel store={store} session={createSessionStore()} runtime={makeRuntime()} defaultOpen />);
    expect(screen.queryByText('Remove everything by this person')).toBeNull();
    act(() => useGuildStore.setState({
      guilds: [{ id: 'guild-1', name: 'Board guild', ownerId: 'user-alice', createdAt: '' }],
    }));
    expect(screen.getByText('Remove everything by this person')).toBeTruthy();
  });

  it('updates regions on geometry-only edits, not on camera moves, and unsubscribes on unmount', () => {
    const store = createBoardStore({ boardId: 'board-1', userId: 'user-alice' });
    store.hydrate({ seq: 1, objects: [
      makeRect('a1', 'user-alice', 0, 0), makeRect('a2', 'user-alice', 100, 0),
    ] });
    const unsubscribed = vi.fn();
    const subscribe = store.subscribeObjects!;
    vi.spyOn(store, 'subscribeObjects').mockImplementation(listener => {
      const unsubscribe = subscribe(listener);
      return () => { unsubscribe(); unsubscribed(); };
    });
    const read = vi.spyOn(store, 'getObjectsInRank');
    const runtime = makeRuntime();
    const { unmount } = render(<PeoplePanel store={store} session={createSessionStore()} runtime={runtime} defaultOpen />);
    expect(screen.getAllByRole('button', { name: /Region \d/ })).toHaveLength(1);
    read.mockClear();
    act(() => runtime.setCamera({ x: 500, y: -200, zoom: 0.5 }));
    expect(read).not.toHaveBeenCalled();
    act(() => { store.dispatch([{
      id: 'a2', action: 'update', expectedVersion: 1, patch: { x: 20_000 },
    }]); });
    expect(screen.getAllByRole('button', { name: /Region \d/ })).toHaveLength(2);
    unmount();
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });

  it('confirms every object matched by a region rectangle, including enclosed disconnected clusters', () => {
    const store = createBoardStore({ boardId: 'board-1', userId: 'user-alice' });
    store.hydrate({ seq: 1, objects: [
      makeRect('top', 'user-alice', 0, 0, 20_000, 300),
      makeRect('left', 'user-alice', 0, 0, 300, 20_000),
      makeRect('inside', 'user-alice', 10_000, 10_000),
      makeRect('other-author', 'user-bob', 10_000, 10_000),
    ] });
    render(<PeoplePanel store={store} session={createSessionStore()} runtime={makeRuntime()} canManage defaultOpen />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove region 1 by Alice Wonderland' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('remove 3 objects?');
  });

  it('hides moderator buttons for non-moderators and runs confirmation + purge for moderators', async () => {
    const store = createBoardStore({ boardId: 'board-1', userId: 'user-alice' });
    const bobRect = makeRect('b1', 'user-bob', 100, 200, 300, 250);
    store.hydrate({ seq: 1, objects: [bobRect] });
    const session = createSessionStore();
    const runtime = makeRuntime();
    const notices = createBoardNotices();
    const onPurge = vi.fn().mockResolvedValue({ deleted: 1 });

    // Non-moderator (user-alice is not guild owner 'user-owner')
    const { unmount } = render(
      <PeoplePanel store={store} session={session} runtime={runtime} notify={notices.notify} defaultOpen />,
    );
    expect(screen.queryByText('Remove everything by this person')).toBeNull();
    expect(screen.queryByText('Remove this region')).toBeNull();
    unmount();

    // Moderator (make user-alice the guild owner)
    act(() => {
      useGuildStore.setState({
        guilds: [{ id: 'guild-1', name: 'Test Guild', ownerId: 'user-alice', createdAt: '' }],
      });
    });

    render(
      <PeoplePanel
        store={store}
        session={session}
        runtime={runtime}
        notify={notices.notify}
        onPurge={onPurge}
        defaultOpen
      />,
    );

    expect(screen.getByText('Remove everything by this person')).toBeTruthy();
    expect(screen.getByText('Remove this region')).toBeTruthy();

    // Click "Remove this region" -> opens confirmation with object count
    fireEvent.click(screen.getByText('Remove this region'));
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm object removal' });
    expect(dialog.textContent).toContain('remove 1 object?');

    fireEvent.click(screen.getByRole('button', { name: /Confirm \(1\)/i }));
    await waitFor(() => {
      expect(onPurge).toHaveBeenCalledWith({
        createdBy: 'user-bob',
        rect: { x: 100, y: 200, w: 300, h: 250 },
      });
    });
    expect(notices.getLatest()?.message).toContain('Removed 1 object.');

    // Surface 429 rate-limit error through notice mechanism
    onPurge.mockRejectedValueOnce(new Error('Too many requests — try again in 5s.'));
    fireEvent.click(screen.getByText('Remove everything by this person'));
    fireEvent.click(screen.getByRole('button', { name: /Confirm \(1\)/i }));
    await waitFor(() => {
      expect(notices.getLatest()?.message).toContain('Too many requests');
    });
  });
});
