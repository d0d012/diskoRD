import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { applyTemplate, TEMPLATES } from '../templates';
import type { ApplyTemplateOptions } from '../templates/applyTemplate';
import { TEMPLATE_CATEGORIES } from '../templates/templates';
import { TemplatePreview } from './TemplatePreview';
import './templateGallery.css';

interface TemplateGalleryProps extends ApplyTemplateOptions {
  readonly board: HTMLElement;
  readonly onClose: () => void;
}
export function TemplateGallery({ board, onClose, ...options }: TemplateGalleryProps) {
  const root = useRef<HTMLDivElement>(null);
  const applied = useRef(false);
  const close = useRef(onClose);
  useLayoutEffect(() => { close.current = onClose; });
  useLayoutEffect(() => {
    const dialog = root.current!;
    const doc = dialog.ownerDocument;
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    function buttons(): HTMLButtonElement[] { return [...dialog.querySelectorAll<HTMLButtonElement>('button')]; }
    function key(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close.current();
      } else if (event.key === 'Tab') {
        const nodes = buttons(); const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    }
    function focus(event: FocusEvent): void {
      if (event.target instanceof Node && !dialog.contains(event.target)) buttons()[0]?.focus();
    }
    doc.addEventListener('keydown', key, true);
    doc.addEventListener('focusin', focus);
    buttons()[0]?.focus({ preventScroll: true });
    return () => {
      doc.removeEventListener('keydown', key, true);
      doc.removeEventListener('focusin', focus);
      const target = applied.current ? board : previous?.isConnected ? previous : board;
      target.focus({ preventScroll: true });
    };
  }, [board]);

  return createPortal(<div className="wb-template-backdrop" data-wb-ui="" onPointerDown={event => {
    if (event.target === event.currentTarget) { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <div ref={root} className="wb-template-gallery" role="dialog" aria-modal="true" aria-label="Template gallery" data-wb-ui="">
      <header><div><h2>Start something together</h2><p>Pick a starting point. Everything stays editable.</p></div>
        <button type="button" onClick={onClose} aria-label="Close template gallery">×</button></header>
      {TEMPLATE_CATEGORIES.map(category => <section key={category} aria-label={category}>
        <h3>{category}</h3><div className="wb-template-grid">
          {TEMPLATES.filter(t => t.category === category).map(template => <button className="wb-template-card" type="button" key={template.id} onClick={() => {
            const ids = applyTemplate(template.id, options);
            if (ids !== null) { applied.current = true; onClose(); }
          }} aria-label={`Insert ${template.name}`}>
            <TemplatePreview template={template} /><strong>{template.name}</strong><span>{template.description}</span>
          </button>)}
        </div>
      </section>)}
    </div>
  </div>, board);
}

interface TemplateGalleryButtonProps extends ApplyTemplateOptions { readonly label?: string }
/** Both entry points share the same gallery and guarded insertion path. */
export function TemplateGalleryButton({ label = 'Templates', ...options }: TemplateGalleryButtonProps) {
  const [board, setBoard] = useState<HTMLElement | null>(null);
  return <>
    <button type="button" className="wb-template-launch" data-wb-ui="" aria-haspopup="dialog" aria-expanded={board !== null}
      onClick={event => setBoard(event.currentTarget.closest<HTMLElement>('[data-wb-viewport]'))}>{label}</button>
    {board && <TemplateGallery {...options} board={board} onClose={() => setBoard(null)}
      getViewportSize={options.getViewportSize ?? (() => board.getBoundingClientRect())} />}
  </>;
}
