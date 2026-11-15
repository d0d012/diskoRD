import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardStore, ImageObject, Point, ResizeHandleId, Runtime } from '../contract';
import type { SessionStore } from '../state/sessionStore';
import { panCropDraft, resetCropDraft, resizeCropDraft, sourceWorldRect } from './cropDraft';
import type { CropDraft } from './cropDraft';
import { assetDisplayUrl } from '../assets/displayUrl';

export interface CropEditorProps {
  readonly store: BoardStore;
  readonly session: SessionStore;
  readonly runtime: Runtime;
}

const HANDLES: readonly ResizeHandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function CropEditor(props: CropEditorProps) {
  const { store, session } = props;
  const id = useStore(session, state => state.croppingId);
  const image = id === null ? undefined : store.getObject(id);
  const usable = image?.kind === 'image';
  useEffect(() => {
    if (id !== null && !usable && session.getState().croppingId === id) session.setCroppingId(null);
  }, [id, usable, session]);
  if (!usable) return null;
  return <CropSurface key={id} {...props} initial={image} />;
}

interface CropSurfaceProps extends CropEditorProps { readonly initial: ImageObject }

function CropSurface({ store, session, runtime, initial }: CropSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLImageElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const brightRef = useRef<HTMLImageElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const crispRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLSpanElement>(null);
  const actions = useRef<{ finish(commit: boolean): void; reset(): void; crisp(): void } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current!;
    const viewport = root.closest<HTMLElement>('[data-wb-viewport]');
    const doc = root.ownerDocument;
    let draft: CropDraft = {
      x: initial.x, y: initial.y, w: initial.w, h: initial.h,
      crop: initial.crop, pixelated: initial.pixelated,
    };
    let finished = false;
    let frame = 0;
    let drag: { pointerId: number; start: Point; draft: CropDraft; handle: ResizeHandleId | null } | null = null;

    // Version changes (including acknowledgment of a pending image), replacement
    // or deletion invalidate this local session. Never retarget a stale draft.
    function valid(): boolean {
      const object = store.getObject(initial.id);
      return object?.kind === 'image' && JSON.stringify(object) === JSON.stringify(initial);
    }
    function focusViewport(): void { viewport?.focus({ preventScroll: true }); }
    function finish(commit: boolean): void {
      if (finished) return;
      if (commit && valid()) {
        const changed = JSON.stringify(draft) !== JSON.stringify({
          x: initial.x, y: initial.y, w: initial.w, h: initial.h,
          crop: initial.crop, pixelated: initial.pixelated,
        });
        if (changed) {
          // Mark before dispatch: the optimistic object notification is synchronous.
          finished = true;
          try {
            store.dispatch([{ id: initial.id, action: 'update', expectedVersion: initial.version, patch: draft }], { label: 'Crop image' });
          } catch {
            finished = false;
            errorRef.current!.textContent = 'That crop could not be saved. Try again or press Escape.';
            return;
          }
        }
      }
      finished = true;
      drag = null;
      if (session.getState().croppingId === initial.id) session.setCroppingId(null);
      focusViewport();
    }
    function paint(): void {
      if (finished) return;
      const zoom = runtime.getCamera().zoom;
      const source = sourceWorldRect(draft, initial);
      const origin = runtime.worldToScreen(source);
      const cropOrigin = runtime.worldToScreen(draft);
      const sourceNode = sourceRef.current!;
      sourceNode.style.transform = `translate(${origin.x}px, ${origin.y}px)`;
      sourceNode.style.width = `${source.w * zoom}px`;
      sourceNode.style.height = `${source.h * zoom}px`;
      const windowNode = windowRef.current!;
      windowNode.style.transform = `translate(${cropOrigin.x}px, ${cropOrigin.y}px)`;
      windowNode.style.width = `${draft.w * zoom}px`;
      windowNode.style.height = `${draft.h * zoom}px`;
      const bright = brightRef.current!;
      bright.style.width = `${source.w * zoom}px`;
      bright.style.height = `${source.h * zoom}px`;
      bright.style.transform = `translate(${origin.x - cropOrigin.x}px, ${origin.y - cropOrigin.y}px)`;
      for (const node of [sourceNode, bright]) node.style.imageRendering = draft.pixelated ? 'pixelated' : 'auto';
      crispRef.current!.setAttribute('aria-pressed', String(draft.pixelated));
      const bar = barRef.current!;
      const width = viewport?.clientWidth ?? root.clientWidth;
      const height = viewport?.clientHeight ?? root.clientHeight;
      const x = Math.max(8, Math.min(width - bar.offsetWidth - 8, cropOrigin.x));
      const y = Math.max(8, Math.min(height - bar.offsetHeight - 8, cropOrigin.y + draft.h * zoom + 16));
      bar.style.transform = `translate(${x}px, ${y}px)`;
    }
    function schedule(): void {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; paint(); });
    }
    function world(event: PointerEvent): Point {
      const bounds = (viewport ?? root).getBoundingClientRect();
      return runtime.screenToWorld({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    }
    function down(event: PointerEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-crop-window]') || event.button !== 0 || drag) return;
      event.preventDefault();
      event.stopPropagation();
      root.focus({ preventScroll: true });
      drag = {
        pointerId: event.pointerId, start: world(event), draft,
        handle: target.closest<HTMLElement>('[data-crop-handle]')?.dataset.cropHandle as ResizeHandleId | undefined ?? null,
      };
      root.setPointerCapture?.(event.pointerId);
    }
    function move(event: PointerEvent): void {
      if (!drag || drag.pointerId !== event.pointerId || finished) return;
      event.preventDefault();
      const point = world(event);
      draft = drag.handle
        ? resizeCropDraft(drag.draft, initial, drag.handle, point)
        : panCropDraft(drag.draft, initial, { x: point.x - drag.start.x, y: point.y - drag.start.y });
      paint();
    }
    function up(event: PointerEvent): void {
      if (drag?.pointerId !== event.pointerId) return;
      move(event);
      drag = null;
      if (root.hasPointerCapture?.(event.pointerId)) root.releasePointerCapture(event.pointerId);
    }
    function cancel(event: PointerEvent): void {
      if (drag?.pointerId !== event.pointerId) return;
      draft = drag.draft;
      drag = null;
      paint();
    }
    function outside(event: PointerEvent): void {
      if (finished || !(event.target instanceof Node) || root.contains(event.target)) return;
      // A finishing click must not also start a board move/create gesture.
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    }
    function key(event: KeyboardEvent): void {
      if (finished || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        finish(event.key === 'Enter');
      }
    }

    // Hide only this stored image, not the shared input-owned RuntimePreview.
    // Culling can unmount/remount it while the camera moves.
    const hiddenNodes = new Set<HTMLElement>();
    function hideOriginal(): void {
      viewport?.querySelectorAll<HTMLElement>('[data-wb-object-id]').forEach(node => {
        if (node.dataset.wbObjectId === initial.id) {
          node.setAttribute('data-wb-crop-original', ''); hiddenNodes.add(node);
        }
      });
    }
    viewport?.setAttribute('data-wb-cropping', '');
    hideOriginal();
    const observer = new MutationObserver(hideOriginal);
    const worldNode = viewport?.querySelector('[data-wb-world]');
    if (worldNode) observer.observe(worldNode, { childList: true, subtree: true });
    const offObject = store.subscribeObject(initial.id, () => { if (!finished && !valid()) finish(false); });
    const offCamera = runtime.subscribeCamera(schedule);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (viewport) resize?.observe(viewport);
    actions.current = {
      finish,
      reset() { draft = resetCropDraft(draft, initial); paint(); },
      crisp() { draft = { ...draft, pixelated: !draft.pixelated }; paint(); },
    };
    root.addEventListener('pointerdown', down);
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', cancel, true);
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', key, true);
    paint();
    root.focus({ preventScroll: true });
    return () => {
      finished = true;
      offObject(); offCamera(); observer.disconnect(); resize?.disconnect();
      cancelAnimationFrame(frame);
      root.removeEventListener('pointerdown', down);
      doc.removeEventListener('pointermove', move, true);
      doc.removeEventListener('pointerup', up, true);
      doc.removeEventListener('pointercancel', cancel, true);
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('keydown', key, true);
      hiddenNodes.forEach(node => node.removeAttribute('data-wb-crop-original'));
      viewport?.removeAttribute('data-wb-cropping');
      actions.current = null;
      // External id changes/unmount cancel rather than accidentally persisting.
    };
    // Keyed by id; the immutable entry snapshot is deliberately captured once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const src = assetDisplayUrl(initial.url);
  return <div ref={rootRef} className="wb-crop-editor" data-wb-ui="" tabIndex={-1} role="dialog" aria-label="Crop image" aria-describedby="wb-crop-help">
    <img ref={sourceRef} className="wb-crop-source" src={src} alt="" draggable={false} />
    <div ref={windowRef} className="wb-crop-window" data-crop-window="">
      <div className="wb-crop-clip"><img ref={brightRef} src={src} alt="Image being cropped" draggable={false} /></div>
      {HANDLES.map(handle => <span key={handle} className={`wb-crop-handle wb-crop-handle--${handle}`} data-crop-handle={handle} aria-hidden="true" />)}
    </div>
    <div ref={barRef} className="wb-crop-bar">
      <span id="wb-crop-help" className="wb-crop-help">Drag edges to crop · drag inside to pan</span>
      <button type="button" onClick={() => actions.current?.reset()}>Reset crop</button>
      <button ref={crispRef} type="button" aria-pressed={initial.pixelated} onClick={() => actions.current?.crisp()}>Crisp pixels</button>
      <button type="button" className="wb-crop-done" onClick={() => actions.current?.finish(true)}>Done</button>
      <span ref={errorRef} role="status" />
    </div>
  </div>;
}
