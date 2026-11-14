import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { useUserStore } from '../../stores/userStore';
import { WhiteboardChannel } from './WhiteboardChannel';
import { createNetworkAdapter } from './sync/networkAdapter';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
  resolveMediaUrl: (url: string | null | undefined) => url ?? undefined,
  setToken: vi.fn(), setSessionHandlers: vi.fn(), refreshSession: vi.fn(), isTokenFresh: vi.fn(),
  startSessionKeeper: vi.fn(), stopSessionKeeper: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

// The network adapter is covered by its own tests; here it is replaced by the in-memory
// authority so the composition (viewport, chrome, store <-> adapter wiring) runs end to end.
vi.mock('./sync/networkAdapter', async () => {
  const { createLocalAdapter } = await import('./sync/localAdapter');
  return {
    createNetworkAdapter: vi.fn((options: { boardId: string; userId: string }) =>
      createLocalAdapter({ boardId: options.boardId, userId: options.userId })),
  };
});

// Real ids are lowercase UUIDs (Go uuid.String()); the local authority validates them.
const USER_ID = '7d2f7c1e-1c1a-4f0e-9a51-2b6c3c1d0e11';
const CHANNEL_ID = '0b9e3a52-5d0c-4f43-8f7d-9c2b1a6e5f22';
const HINT = /A little space for big ideas/;

let warn: MockInstance<typeof console.warn>;

function signIn(id: string): void {
  useAuthStore.setState({ user: { id, username: 'me', status: 'online', createdAt: '2026-01-01T00:00:00Z' } } as never);
}

/** Lets the local adapter tasks, the coordinator pump and React commits run. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function pointer(target: Element, type: string, x: number, y: number): void {
  fireEvent(target, new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse',
  }));
}

async function mount(strict: boolean, channelId = CHANNEL_ID) {
  const tree = <WhiteboardChannel channelId={channelId} />;
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  await settle();
  const viewport = view.container.querySelector<HTMLElement>('[data-wb-viewport]')!;
  return { ...view, viewport };
}

async function drawStroke(viewport: HTMLElement): Promise<void> {
  fireEvent.keyDown(viewport, { key: 'p' });
  act(() => {
    pointer(viewport, 'pointerdown', 20, 20);
    pointer(viewport, 'pointermove', 60, 40);
    pointer(viewport, 'pointermove', 120, 90);
    pointer(viewport, 'pointerup', 120, 90);
  });
  await settle();
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  signIn(USER_ID);
  warn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe('WhiteboardChannel', () => {
  it('composes the viewport, dock, zoom and history with an empty-board hint', async () => {
    const { container, unmount } = await mount(false);
    expect(container.querySelector('[data-wb-viewport]')).not.toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Board tools' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Board zoom' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Board history' })).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });

  it('builds the real adapter with the store identities, a roster name resolver and the live chrome', async () => {
    useUserStore.setState({ users: { 'u-2': { id: 'u-2', username: 'bob', displayName: 'Bobby' } } });
    const { unmount } = await mount(false);
    expect(createNetworkAdapter).toHaveBeenCalledWith(expect.objectContaining({ boardId: CHANNEL_ID, userId: USER_ID }));
    const { resolveName } = vi.mocked(createNetworkAdapter).mock.calls.at(-1)![0];
    expect(resolveName?.('u-2')).toBe('Bobby');
    expect(resolveName?.('nobody')).toBeUndefined();
    expect(screen.getByText(/saved automatically/)).toBeInTheDocument();
    expect(screen.queryByText(/until you leave/)).toBeNull();
    unmount();
  });

  it('renders nothing without a signed-in user', () => {
    useAuthStore.setState({ user: null } as never);
    const { container } = render(<WhiteboardChannel channelId={CHANNEL_ID} />);
    expect(container.firstChild).toBeNull();
  });

  it.each([false, true])('a drawn stroke stays and hides the empty hint (StrictMode: %s)', async strict => {
    const { viewport, unmount } = await mount(strict);
    expect(screen.getByText(HINT)).toBeInTheDocument();
    await drawStroke(viewport);
    expect(screen.queryByText(HINT)).toBeNull();
    const nodes = viewport.querySelectorAll('[data-wb-object-id]');
    expect(nodes).toHaveLength(1);
    // Still there after every pending task: the create was acknowledged, not rejected.
    await settle();
    expect(viewport.querySelectorAll('[data-wb-object-id]')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    unmount();
  });

  it('the Undo button and the keyboard share one history', async () => {
    const { viewport } = await mount(true);
    await drawStroke(viewport);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    await settle();
    // Deleted nodes play a short exit animation before they unmount.
    await waitFor(() => expect(viewport.querySelectorAll('[data-wb-object-id]')).toHaveLength(0));
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(redo).toBeEnabled();
    // Redo from the keyboard undoes the button's undo.
    fireEvent.keyDown(viewport, { key: 'z', ctrlKey: true, shiftKey: true });
    await settle();
    await waitFor(() => expect(viewport.querySelectorAll('[data-wb-object-id]')).toHaveLength(1));
    // And keyboard undo enables the Redo button.
    fireEvent.keyDown(viewport, { key: 'z', metaKey: true });
    await settle();
    await waitFor(() => expect(viewport.querySelectorAll('[data-wb-object-id]')).toHaveLength(0));
    expect(redo).toBeEnabled();
  });

  it('double-click creates a text object; typed text is committed and rendered', async () => {
    const { viewport } = await mount(true);
    act(() => { fireEvent.doubleClick(viewport, { clientX: 100, clientY: 100, button: 0 }); });
    const area = await screen.findByRole('textbox', { name: 'Edit text' });
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.input(area, { target: { value: 'Hello board' } });
    act(() => { area.blur(); });
    await settle();
    expect(screen.queryByRole('textbox', { name: 'Edit text' })).toBeNull();
    const node = viewport.querySelector('[data-wb-object-id]');
    expect(node).not.toBeNull();
    expect(node!.textContent).toContain('Hello board');
    expect(warn).not.toHaveBeenCalled();
  });

  it('the Image tool opens the picker above the dock and closing it returns to Select', async () => {
    const { viewport } = await mount(true);
    expect(screen.queryByRole('dialog', { name: 'Add image' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add image' });
    expect(dialog.closest('.wb-assets-anchor')).not.toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add image' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    // The I shortcut opens it too.
    act(() => { viewport.focus(); });
    fireEvent.keyDown(viewport, { key: 'i' });
    expect(await screen.findByRole('dialog', { name: 'Add image' })).toBeInTheDocument();
  });

  it('a picked file goes through the shared ingest (an undecodable one is reported, nothing is created)', async () => {
    // jsdom cannot decode images: make every decode fail, as a corrupt file would.
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    });
    const { viewport } = await mount(false);
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    const input = (await screen.findByLabelText('Choose images')) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
    await settle();
    expect(await screen.findByText('That image could not be read')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add image' })).toBeNull();
    expect(viewport.querySelectorAll('[data-wb-object-id]')).toHaveLength(0);
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('shows a start error instead of crashing when the identities are not UUIDs', async () => {
    signIn('not-a-uuid');
    await mount(false, 'board-1');
    expect(screen.getByRole('alert')).toHaveTextContent(/could not connect/);
    expect(warn).toHaveBeenCalled();
  });
});
