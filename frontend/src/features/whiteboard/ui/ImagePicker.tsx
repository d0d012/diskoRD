import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArtThumb } from '../../pixelart/ArtThumb';
import { createPixelArtSource } from './pixelArtSource';
import type { GalleryImage, PixelArtSource } from './pixelArtSource';

export interface ImagePickerProps {
  readonly onPick: (files: readonly Blob[], options: { pixelated: boolean }) => void;
  readonly onClose: () => void;
  /** Optional boundary for canvas-free tests and alternate gallery sources. */
  readonly source?: PixelArtSource;
}

const FOCUSABLE = 'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), [href], [tabindex="0"]';

export function ImagePicker({ onPick, onClose, source }: ImagePickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onPick, onClose });
  useLayoutEffect(() => { callbacks.current = { onPick, onClose }; });
  const [gallerySource] = useState(() => source ?? createPixelArtSource());
  const [tab, setTab] = useState<'upload' | 'pixel-art'>('upload');
  const id = useId();

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
        // Do not turn the dismissing click into an accidental canvas edit.
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

  function pick(files: readonly Blob[], pixelated: boolean): void {
    if (!files.length) return;
    callbacks.current.onPick(files, { pixelated });
    callbacks.current.onClose();
  }
  function tabKey(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'upload' : event.key === 'End' ? 'pixel-art' : tab === 'upload' ? 'pixel-art' : 'upload';
    setTab(next);
    rootRef.current?.querySelector<HTMLButtonElement>(`[data-image-tab="${next}"]`)?.focus();
  }

  return <div ref={rootRef} className="wb-image-picker" data-wb-ui="" role="dialog" aria-modal="true" aria-label="Add image" tabIndex={-1}>
    <header><h2>Add image</h2><button type="button" aria-label="Close image picker" onClick={onClose}>×</button></header>
    <div role="tablist" aria-label="Image source" className="wb-image-tabs">
      <button type="button" role="tab" id={`${id}-upload-tab`} aria-controls={`${id}-upload-panel`} aria-selected={tab === 'upload'} tabIndex={tab === 'upload' ? 0 : -1} data-image-tab="upload" onKeyDown={tabKey} onClick={() => setTab('upload')}>Upload</button>
      <button type="button" role="tab" id={`${id}-art-tab`} aria-controls={`${id}-art-panel`} aria-selected={tab === 'pixel-art'} tabIndex={tab === 'pixel-art' ? 0 : -1} data-image-tab="pixel-art" onKeyDown={tabKey} onClick={() => setTab('pixel-art')}>Pixel art</button>
    </div>
    <div role="tabpanel" id={`${id}-upload-panel`} aria-labelledby={`${id}-upload-tab`} hidden={tab !== 'upload'}>
      <label className="wb-image-upload">Choose images<input type="file" aria-label="Choose images" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,image/x-icon,image/tiff" multiple onChange={event => {
        pick(Array.from(event.target.files ?? []), false);
        event.target.value = '';
      }} /></label>
      <p className="wb-image-hint">Paste an image or drag and drop it onto the board, too. Raster images only; no SVG.</p>
    </div>
    <div role="tabpanel" id={`${id}-art-panel`} aria-labelledby={`${id}-art-tab`} hidden={tab !== 'pixel-art'}>
      {tab === 'pixel-art' && <Gallery source={gallerySource} onPick={blob => pick([blob], true)} />}
    </div>
  </div>;
}

interface GalleryProps { readonly source: PixelArtSource; readonly onPick: (blob: Blob) => void }

function Gallery({ source, onPick }: GalleryProps) {
  const [items, setItems] = useState<readonly GalleryImage[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const active = useRef(false);
  const picking = useRef(false);
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    source.list().then(list => { if (!cancelled) setItems(list); }).catch(() => {
      if (!cancelled) setError('Your pixel art could not be loaded. Please try again.');
    });
    return () => { cancelled = true; active.current = false; };
  }, [source, retry]);

  async function choose(piece: GalleryImage): Promise<void> {
    if (picking.current) return;
    picking.current = true;
    setBusy(piece.id); setError('');
    try {
      const blob = await source.rasterize(piece);
      if (active.current) onPick(blob);
    } catch {
      if (active.current) setError('That artwork could not be rendered. Please try another piece.');
    } finally {
      picking.current = false;
      if (active.current) setBusy(null);
    }
  }
  return <>
    {error && <div className="wb-image-error" role="alert">{error}{items === null && <button type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Try again</button>}</div>}
    {items === null && !error && <p role="status">Loading your pixel art…</p>}
    {items?.length === 0 && <p className="wb-image-hint">No little masterpieces yet. Open the pixel-art editor from the chat composer and save a piece to My art — it will appear here.</p>}
    {items && items.length > 0 && <div className="wb-image-gallery" aria-label="Your pixel art" aria-busy={busy !== null}>
      {items.map(piece => <button type="button" key={piece.id} title={piece.title || 'Untitled artwork'} aria-label={piece.title || 'Untitled artwork'} disabled={busy !== null} onClick={() => void choose(piece)}>
        <span className="wb-image-thumb"><ArtThumb doc={piece.doc} size={64} /></span>
        <span className="wb-image-title">{busy === piece.id ? 'Preparing…' : piece.title || 'Untitled artwork'}</span>
      </button>)}
    </div>}
  </>;
}
