import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StampPicker } from './StampPicker';

describe('StampPicker', () => {
  it('renders all 16 stickers and arms one without closing the tool', () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<StampPicker onPick={onPick} onClose={onClose} />);

    expect(screen.getAllByRole('button')).toHaveLength(17); // 16 stickers + close
    fireEvent.click(screen.getByRole('button', { name: 'Star' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('star');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape and via the close button', () => {
    const onClose = vi.fn();
    const view = render(<StampPicker onPick={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close stamp picker' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
  });
});
