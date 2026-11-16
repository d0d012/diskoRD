import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createHarness, USER } from '../input/testUtils';
import { TEMPLATES } from '../templates';
import { TemplateGalleryButton } from './TemplateGallery';
import { EmptyState } from './EmptyState';
import { usePixelArtStore } from '../../../stores/pixelArtStore';

function setup() {
  const h = createHarness(); const notify = vi.fn();
  const view = render(<div data-wb-viewport="" tabIndex={0}>
    <TemplateGalleryButton store={h.store} session={h.session} runtime={h.runtime} userId={USER} notify={notify}
      getViewportSize={() => ({ width: 1000, height: 800 })} />
  </div>);
  return { h, notify, board: view.container.querySelector<HTMLElement>('[data-wb-viewport]')! };
}

describe('Template gallery', () => {
  it('opens a categorized catalogue with item-derived previews, traps focus, and closes with Escape', () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'Templates' });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Template gallery' });
    for (const category of ['Planning', 'Brainstorm', 'Design', 'Fun']) expect(within(dialog).getByRole('region', { name: category })).toBeTruthy();
    expect(within(dialog).getAllByRole('button')).toHaveLength(TEMPLATES.length + 1);
    expect(dialog.querySelectorAll('svg')).toHaveLength(TEMPLATES.length);
    expect(dialog.querySelectorAll('svg rect').length).toBeGreaterThan(TEMPLATES.length);
    const close = within(dialog).getByRole('button', { name: 'Close template gallery' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    const last = within(dialog).getAllByRole('button').at(-1)!;
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });

  it('lets WebKit-style clicks through: focus landing on the hosting board does not jump back to the top', () => {
    const { h, board } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    const dialog = screen.getByRole('dialog', { name: 'Template gallery' });
    const card = within(dialog).getByRole('button', { name: 'Insert Icebreaker' });
    // WebKit does not focus a clicked button; focus goes to the board ancestor.
    board.focus();
    expect(document.activeElement).toBe(board);
    fireEvent.click(card);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.store.getObjectIds().length).toBeGreaterThan(0);
  });

  it('applies on an already populated board as a single command and restores board focus', () => {
    const { h, board } = setup();
    const trigger = screen.getByRole('button', { name: 'Templates' });
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: 'Insert Kanban' }));
    h.ackAll();
    const previous = h.store.getObjectIds().length;
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: 'Insert Brainstorm / mind map' }));
    expect(h.store.getObjectIds().length).toBeGreaterThan(previous);
    expect(h.store.getPendingOperations()).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(board);
  });

  it('keeps the gallery open when placement is refused and reports a notice', () => {
    const { h, notify } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert Kanban' })); h.ackAll();
    h.runtime.setCamera({ x: -100000, y: 0, zoom: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert SWOT' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(notify).toHaveBeenCalledWith('refused', 'Too far from existing content.');
    fireEvent.click(screen.getByRole('button', { name: 'Close template gallery' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is also reachable from the empty state All templates button', () => {
    const h = createHarness();
    usePixelArtStore.setState({ profiles: { [USER]: { showcase: [], buddies: [], banner: null } } });
    render(<div data-wb-viewport="" tabIndex={0}><EmptyState store={h.store} session={h.session} runtime={h.runtime} userId={USER} notify={vi.fn()} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'All templates' }));
    expect(screen.getByRole('dialog', { name: 'Template gallery' })).toBeTruthy();
  });
});
