import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PixelArtDoc } from '../../pixelart/lib/doc';
import { usePixelArtStore } from '../../../stores/pixelArtStore';
import { createHarness, USER } from '../input/testUtils';
import { EmptyState } from './EmptyState';
import { applyTemplate } from '../templates';

vi.mock('../../pixelart/decorationImage', () => ({
  trimmedImage: (doc: unknown) => (doc
    ? { url: 'data:image/png;base64,buddy', width: 16, height: 16, canvas: null }
    : null),
  buddyWidth: () => 16,
}));
vi.mock('../../pixelart/sharpScale', () => ({
  useSharpArtUrl: (image: unknown) => ({ url: image ? (image as { url: string }).url : undefined, imageRendering: 'pixelated' as const }),
}));
vi.mock('../templates', async importOriginal => {
  const original = await importOriginal<typeof import('../templates')>();
  return { ...original, applyTemplate: vi.fn() };
});

function doc(): PixelArtDoc {
  return { v: 1, width: 16, height: 16, palette: ['#ff0000'], frames: [btoa('\x00'.repeat(256))] };
}

function setBuddy(hasBuddy: boolean): void {
  usePixelArtStore.setState({
    profiles: {
      [USER]: {
        showcase: [],
        buddies: hasBuddy
          ? [{ artId: 'a', x: 50, y: 20, height: 48, flip: false, front: false, doc: doc() }]
          : [],
        banner: null,
      },
    },
  });
}

function renderEmpty() {
  const h = createHarness();
  const view = render(<EmptyState store={h.store} session={h.session} runtime={h.runtime} userId={USER}
    notify={vi.fn()} getViewportSize={() => ({ width: 1000, height: 800 })} />);
  return { h, view };
}

beforeEach(() => {
  usePixelArtStore.setState({ profiles: {} });
  vi.mocked(applyTemplate).mockClear();
});

describe('EmptyState', () => {
  it('offers the four starter templates and applies one', () => {
    setBuddy(false);
    const { h } = renderEmpty();

    const names = screen.getAllByRole('button').map(button => button.textContent);
    expect(names).toEqual(['Sprint board', 'Retro', 'Moodboard', 'Sprite critique wall']);

    fireEvent.click(screen.getByRole('button', { name: 'Sprint board' }));
    expect(applyTemplate).toHaveBeenCalledExactlyOnceWith('sprint', expect.objectContaining({ store: h.store, userId: USER }));
  });

  it('renders the user pixel buddy when they have one', () => {
    setBuddy(true);
    const { view } = renderEmpty();
    expect(view.container.querySelector('img')).not.toBeNull();
    expect(view.container.querySelector('.wb-empty-fallback')).toBeNull();
  });

  it('falls back to a quiet pixel glyph when there is no buddy', () => {
    setBuddy(false);
    const { view } = renderEmpty();
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('.wb-empty-fallback')).not.toBeNull();
  });
});
