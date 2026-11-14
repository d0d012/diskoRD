import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImagePicker } from './ImagePicker';
import type { GalleryImage, PixelArtSource } from './pixelArtSource';

vi.mock('../../pixelart/ArtThumb', () => ({ ArtThumb: () => <span data-testid="art-thumb" /> }));

const piece: GalleryImage = {
  id: 'art', title: 'Pixel buddy',
  doc: { v: 1, width: 16, height: 16, palette: ['#ff0000'], frames: [btoa('\x00'.repeat(256))] },
};

function setup(overrides: Partial<PixelArtSource> = {}) {
  const source = { list: vi.fn().mockResolvedValue([piece]), rasterize: vi.fn().mockResolvedValue(new Blob(['png'], { type: 'image/png' })), ...overrides };
  const onPick = vi.fn();
  const onClose = vi.fn();
  const view = render(<ImagePicker source={source} onPick={onPick} onClose={onClose} />);
  const gallery = () => fireEvent.click(screen.getByRole('tab', { name: 'Pixel art' }));
  return { source, onPick, onClose, view, gallery };
}

describe('ImagePicker', () => {
  it('opens on Upload with UI marker, raster accept list, multiple and paste/drop hint', () => {
    const { view, source } = setup();
    expect(screen.getByRole('dialog').hasAttribute('data-wb-ui')).toBe(true);
    expect(screen.getByRole('tab', { name: 'Upload' }).getAttribute('aria-selected')).toBe('true');
    const input = view.container.querySelector('input')!;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('image/png');
    expect(input.accept).not.toContain('svg');
    expect(screen.getByText(/Paste an image or drag and drop/)).toBeTruthy();
    expect(source.list).not.toHaveBeenCalled();
  });

  it('uploads multiple files with pixelated false and closes', () => {
    const { onPick, onClose } = setup();
    const files = [new File(['png'], 'one.png', { type: 'image/png' }), new File(['jpeg'], 'two.jpg', { type: 'image/jpeg' })];
    fireEvent.change(screen.getByLabelText('Choose images'), { target: { files } });
    expect(onPick).toHaveBeenCalledExactlyOnceWith(files, { pixelated: false });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches tabs, shows loading then gallery, rasterizes one piece with crisp pixels', async () => {
    let resolve!: (items: readonly GalleryImage[]) => void;
    const { gallery, source, onPick, onClose } = setup({ list: vi.fn(() => new Promise<readonly GalleryImage[]>(r => { resolve = r; })) });
    gallery();
    expect(screen.getByRole('tab', { name: 'Pixel art' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Loading');
    await act(async () => resolve([piece]));
    expect(screen.getByTestId('art-thumb')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pixel buddy' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(source.rasterize).toHaveBeenCalledExactlyOnceWith(piece);
    expect(onPick.mock.calls[0][0][0]).toBeInstanceOf(Blob);
    expect(onPick.mock.calls[0][1]).toEqual({ pixelated: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a friendly empty state pointing to the editor', async () => {
    const { gallery } = setup({ list: vi.fn().mockResolvedValue([]) });
    gallery();
    expect(await screen.findByText(/No little masterpieces yet/)).toHaveProperty('textContent', expect.stringContaining('pixel-art editor'));
  });

  it('shows list errors and can retry', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([piece]);
    const { gallery } = setup({ list });
    gallery();
    expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Pixel buddy' })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('shows renderer errors without closing, and allows another try', async () => {
    const { gallery, onPick, onClose } = setup({ rasterize: vi.fn().mockRejectedValue(new Error('no canvas')) });
    gallery();
    fireEvent.click(await screen.findByRole('button', { name: 'Pixel buddy' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be rendered');
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pixel buddy' })).not.toBeDisabled());
  });

  it('Escape and outside pointer presses close', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('outside clicks close without also starting a canvas action', () => {
    const { onClose } = setup();
    const outside = vi.fn();
    document.body.addEventListener('pointerdown', outside);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
    document.body.removeEventListener('pointerdown', outside);
  });

  it('traps focus, supports arrow-key tabs and restores trigger focus on unmount', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger); trigger.focus();
    const { view } = setup();
    const close = screen.getByRole('button', { name: 'Close image picker' });
    const input = screen.getByLabelText('Choose images');
    expect(document.activeElement).toBe(close);
    input.focus();
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Upload' }), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Pixel art' }));
    await screen.findByRole('button', { name: 'Pixel buddy' });
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('does not pick after unmount or tab switch while a PNG is pending', async () => {
    let resolve!: (blob: Blob) => void;
    const { gallery, onPick, onClose } = setup({ rasterize: () => new Promise(r => { resolve = r; }) });
    gallery();
    fireEvent.click(await screen.findByRole('button', { name: 'Pixel buddy' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Upload' }));
    await act(async () => resolve(new Blob()));
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
