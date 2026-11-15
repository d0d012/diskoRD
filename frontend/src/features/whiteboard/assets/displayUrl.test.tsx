import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ImageObject } from '../contract';
import { createBoardStore } from '../state/boardStore';
import { createSessionStore } from '../state/sessionStore';
import { createRuntime } from '../render/runtime';
import { BoardObjectView } from '../render/objects/BoardObjectView';
import { createGhostObject } from '../render/overlays/ghostObject';
import { CropEditor } from '../editing/CropEditor';
import { assetDisplayUrl } from './displayUrl';

/*
 * Production regression: the backend runs with an EMPTY storage baseURL, so
 * board assets come back as relative "/uploads/board-assets/..." URLs. In the
 * desktop (Tauri) build the page origin is the Tauri origin and the API is an
 * absolute https origin, so every <img> must be resolved against the API
 * origin -- while the stored object url stays exactly what the server sent.
 */
const DESKTOP_API = 'https://diskord.example.com/api';
vi.mock('../../../lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, resolveMediaUrl: (url: string | null | undefined) => actual.resolveMediaUrlAgainst(url, DESKTOP_API) };
});

const STORED = '/uploads/board-assets/0b0e4a1e-1111-4111-8111-111111111111/abc.png';
const RESOLVED = 'https://diskord.example.com/uploads/board-assets/0b0e4a1e-1111-4111-8111-111111111111/abc.png';

const image: ImageObject = {
  id: 'i1', kind: 'image', createdBy: 'me', version: 1, rank: '1:a0',
  x: 100, y: 200, w: 200, h: 100, assetId: '11111111-1111-4111-8111-111111111111', url: STORED,
  width: 800, height: 400, crop: { x: 0, y: 0, w: 1, h: 1 }, pixelated: false,
};

describe('board asset display URLs in the desktop build', () => {
  it('resolves relative server URLs against the API origin and leaves others alone', () => {
    expect(assetDisplayUrl(STORED)).toBe(RESOLVED);
    expect(assetDisplayUrl('https://cdn.example.com/x.png')).toBe('https://cdn.example.com/x.png');
    expect(assetDisplayUrl('blob:tauri://localhost/123')).toBe('blob:tauri://localhost/123');
  });

  it('rendered board images load from the API origin; the object url is untouched', () => {
    const { container } = render(<BoardObjectView object={image} />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe(RESOLVED);
    expect(image.url).toBe(STORED);
  });

  it('presence ghosts of images load from the API origin', () => {
    expect(createGhostObject(document, image).querySelector('img')!.getAttribute('src')).toBe(RESOLVED);
  });

  it('the crop editor loads the image from the API origin', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    store.hydrate({ seq: 1, objects: [image] });
    const session = createSessionStore();
    render(<div data-wb-viewport="" tabIndex={0}>
      <div data-wb-world=""><div data-wb-object-id="i1" /></div>
      <CropEditor store={store} session={session} runtime={createRuntime()} />
    </div>);
    act(() => session.setCroppingId('i1'));
    const dialog = screen.getByRole('dialog', { name: 'Crop image' });
    const sources = [...dialog.querySelectorAll('img')].map(img => img.getAttribute('src'));
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every(src => src === RESOLVED)).toBe(true);
    expect(store.getObject('i1')).toMatchObject({ url: STORED });
  });
});
