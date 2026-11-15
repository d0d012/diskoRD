import { useLayoutEffect, useRef } from 'react';
import { STAMPS } from './stamps';
import { StampGlyph } from './StampGlyph';
import './stamps.css';

export interface StampPickerProps {
  readonly onPick: (stampId: string) => void;
  readonly onClose: () => void;
}

const FOCUSABLE = 'button:not(:disabled):not([tabindex="-1"]), [tabindex="0"]';

/** Small popover of built-in stamps. Picking arms one; the next board click places it. */
export function StampPicker({ onPick, onClose }: StampPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onPick, onClose });
  useLayoutEffect(() => { callbacks.current = { onPick, onClose }; });

  useLayoutEffect(() => {
    const root = rootRef.current!;
    const doc = root.ownerDocument;
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    let closed = false;
    function close(): void {
      if (closed) return;
      closed = true;
      callbacks.current.onClose();
    }
    function focusables(): HTMLElement[] {
      return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(node => !node.closest('[hidden]'));
    }
    function key(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close();
      } else if (event.key === 'Tab') {
        const nodes = focusables();
        const first = nodes[0] ?? root;
        const last = nodes[nodes.length - 1] ?? root;
        if (event.shiftKey && (doc.activeElement === first || !root.contains(doc.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (doc.activeElement === last || !root.contains(doc.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    }
    function outside(event: PointerEvent): void {
      if (event.target instanceof Node && !root.contains(event.target)) {
        // The dismissing click must not become an accidental board edit.
        event.preventDefault(); event.stopPropagation(); close();
      }
    }
    function focus(event: FocusEvent): void {
      if (!closed && event.target instanceof Node && !root.contains(event.target)) (focusables()[0] ?? root).focus();
    }
    doc.addEventListener('keydown', key, true);
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('focusin', focus);
    (focusables()[0] ?? root).focus({ preventScroll: true });
    return () => {
      closed = true;
      doc.removeEventListener('keydown', key, true);
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('focusin', focus);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div ref={rootRef} className="wb-stamp-picker" data-wb-ui="" role="dialog" aria-modal="true" aria-label="Stamps" tabIndex={-1}>
      <header><h2>Stamps</h2><button type="button" aria-label="Close stamp picker" onClick={onClose}>×</button></header>
      <div className="wb-stamp-grid" aria-label="Stickers">
        {STAMPS.map(stamp => (
          <button type="button" key={stamp.id} title={stamp.name} aria-label={stamp.name}
            onClick={() => callbacks.current.onPick(stamp.id)}>
            <StampGlyph stamp={stamp} size={40} />
          </button>
        ))}
      </div>
      <p className="wb-stamp-hint">Pick a sticker, then click the board to place it.</p>
    </div>
  );
}
