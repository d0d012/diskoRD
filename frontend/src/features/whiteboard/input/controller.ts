import { ERASER_RADIUS_PX } from '../contract';
import type { BoardStore, HandleId, ObjectId, Point, Runtime, UserId } from '../contract';
import type { BoardNotify, SessionStore } from '../state';
import { carriesFiles, copySelection, filesOf, pasteObjects, pasteText } from './clipboard';
import type { BoardClipboard } from './clipboard';
import {
  deleteSelection, duplicateSelection, editSelection, isComposing, isGuardedElement, matchShortcut,
  nudgeSelection, reorderSelection, selectAll,
} from './shortcuts';
import type { ShortcutAction } from './shortcuts';
import { clearPreview, reportRefusal, safeDispatch, updateChange } from './objects';
import { beginGesture, handleDoubleClick } from './tools';
import type { Gesture, InputPresence, PointerSample, ToolContext } from './types';
import { createPresenceSender, isSoftLocked } from './presence';
import { cameraForWheel, cameraToFit } from './wheel';
import { toggleCheckboxLine, toggleStickyReaction, zoomAt } from '../core';
import { paintObject } from '../render/objects/presentation';

export interface InputControllerOptions {
  readonly element: HTMLElement;
  readonly store: BoardStore;
  readonly session: SessionStore;
  readonly runtime: Runtime;
  readonly userId: UserId;
  /** The Image shortcut (I) was pressed; the host opens its picker. */
  readonly onRequestImage?: () => void;
  /**
   * Image files pasted (`at` = pointer, or null with no pointer over the board)
   * or dropped (`at` = drop point), in world space. Without this, paste/drop of
   * files is ignored.
   */
  readonly onImageFiles?: (files: readonly Blob[], at: Point | null) => void;
  /**
   * Refused actions (over a contract limit, invalid input). Undo/redo go through
   * store.undo()/redo(): the store owns the board's only history.
   */
  readonly onNotice?: BoardNotify;
  readonly presence?: InputPresence;
}

export interface InputController {
  dispose(): void;
}

interface ActiveGesture {
  readonly pointerId: number;
  readonly gesture: Gesture;
  last: PointerSample;
}

/** Safari/WKWebView trackpad pinch events (non-standard). */
interface GestureEventLike extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

const HANDLE_IDS: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'start', 'end'];

function asHandle(value: string | undefined): HandleId | null {
  return value && (HANDLE_IDS as readonly string[]).includes(value) ? value as HandleId : null;
}

/** A ring the size of the eraser's reach (ERASER_RADIUS_PX), hotspot at its centre. */
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='${ERASER_RADIUS_PX * 2 + 2}' height='${ERASER_RADIUS_PX * 2 + 2}'><circle cx='${ERASER_RADIUS_PX + 1}' cy='${ERASER_RADIUS_PX + 1}' r='${ERASER_RADIUS_PX}' fill='rgba(255,255,255,0.15)' stroke='white' stroke-width='1.5'/><circle cx='${ERASER_RADIUS_PX + 1}' cy='${ERASER_RADIUS_PX + 1}' r='${ERASER_RADIUS_PX}' fill='none' stroke='black' stroke-width='0.5'/></svg>`,
)}") ${ERASER_RADIUS_PX + 1} ${ERASER_RADIUS_PX + 1}, crosshair`;

function cursorFor(tool: string, spaceHeld: boolean, panning: boolean): string {
  if (panning) return 'grabbing';
  if (spaceHeld || tool === 'hand') return 'grab';
  if (tool === 'select') return '';
  if (tool === 'eraser') return ERASER_CURSOR;
  return 'crosshair';
}

/**
 * Owns all pointer, wheel, keyboard and clipboard input on the viewport
 * element. Gesture moves only touch the Runtime (preview/camera); each
 * finished gesture performs at most one store dispatch.
 */
export function createInputController(options: InputControllerOptions): InputController {
  const { element, store, session, runtime, userId, onRequestImage, onImageFiles, onNotice } = options;
  const doc = element.ownerDocument;
  const win = doc.defaultView ?? window;
  const presence = options.presence ? {
    send: createPresenceSender(fields => options.presence!.send(fields)),
    getParticipants: () => options.presence!.getParticipants(),
  } : undefined;
  const ctx: ToolContext = { store, session, runtime, userId, newId: () => crypto.randomUUID(), notify: onNotice, presence };

  let active: ActiveGesture | null = null;
  let spaceHeld = false;
  let lastPointer: Point | null = null;
  let clipboard: BoardClipboard | null = null;
  /** Text for the copy/cut event that follows a Ctrl/Cmd+C/X keydown. */
  let pendingSystemText: string | null = null;
  let pinchStartZoom: number | null = null;
  let disposed = false;

  const addedTabIndex = !element.hasAttribute('tabindex');
  if (addedTabIndex) element.setAttribute('tabindex', '0');
  const originalCursor = element.style.cursor;

  function updateCursor(): void {
    element.style.cursor = cursorFor(session.getState().tool, spaceHeld, active?.gesture.kind === 'panning');
  }

  function bounds(): DOMRect {
    return element.getBoundingClientRect();
  }

  function screenOf(event: { clientX: number; clientY: number }, rect = bounds()): Point {
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function sampleOf(event: PointerEvent | MouseEvent, rect = bounds()): PointerSample {
    const screen = screenOf(event, rect);
    const pen = 'pointerType' in event && event.pointerType === 'pen';
    const pressure = pen && Number.isFinite(event.pressure) ? Math.min(1, Math.max(0, event.pressure)) : 0.5;
    return {
      screen,
      world: runtime.screenToWorld(screen),
      pressure,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      modKey: event.ctrlKey || event.metaKey,
    };
  }

  /** The same screen sample re-projected after a camera change or modifier change. */
  function resample(sample: PointerSample, shiftKey = sample.shiftKey): PointerSample {
    return { ...sample, world: runtime.screenToWorld(sample.screen), shiftKey };
  }

  function boardFocused(): boolean {
    const focused = doc.activeElement;
    if (!focused || focused === doc.body) return false;
    return (focused === element || element.contains(focused)) && !isGuardedElement(focused);
  }

  function blockedTarget(target: EventTarget | null): boolean {
    return target instanceof win.Element && isGuardedElement(target);
  }

  function releaseCapture(pointerId: number): void {
    try {
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    } catch {
      // Capture may already be gone (element detached); nothing to release.
    }
  }

  function cancelActive(): void {
    const current = active;
    if (!current) return;
    active = null;
    current.gesture.cancel();
    if (current.gesture.kind === 'translating') presence?.send({ drag: null });
    releaseCapture(current.pointerId);
    updateCursor();
  }

  function finishActive(sample: PointerSample): void {
    const current = active;
    if (!current) return;
    active = null;
    try {
      current.gesture.end(sample);
    } catch (error) {
      // Never leave a stuck preview behind, whatever went wrong.
      clearPreview(runtime);
      console.error('whiteboard: gesture failed', error);
    } finally {
      if (current.gesture.kind === 'translating') presence?.send({ drag: null });
      releaseCapture(current.pointerId);
      updateCursor();
    }
  }

  /* ---------------------------------------------------------------- pointer */

  function closeOpenReactionPickers(except?: HTMLElement | null): boolean {
    let closed = false;
    for (const openContainer of element.querySelectorAll<HTMLElement>('[data-wb-sticky-reactions][data-open="true"]')) {
      if (openContainer === except) continue;
      openContainer.dataset.open = 'false';
      const objectNode = openContainer.closest<HTMLDivElement>('[data-wb-object-id]');
      const objectId = objectNode?.dataset.wbObjectId;
      const object = objectId ? store.getObject(objectId) : undefined;
      if (objectNode && object) {
        paintObject(objectNode, object, session.getState().editingId === object.id, false, true);
      }
      closed = true;
    }
    return closed;
  }

  function onPointerDown(event: PointerEvent): void {
    if (blockedTarget(event.target)) return;
    if (active) {
      // A second pointer (another finger/button) never starts a parallel gesture.
      if (event.pointerId !== active.pointerId) return;
      cancelActive();
    }
    const target = event.target instanceof win.Element ? event.target : null;
    if (event.button === 0 && !spaceHeld && session.getState().tool === 'select' && target && element.contains(target)) {
      const checkboxEl = target.closest<HTMLElement>('[data-wb-checkbox-line]');
      if (checkboxEl && element.contains(checkboxEl)) {
        closeOpenReactionPickers();
        event.preventDefault();
        event.stopPropagation();
        const objectId = checkboxEl.dataset.wbCheckboxObject;
        const lineIndex = Number(checkboxEl.dataset.wbCheckboxLine);
        const object = objectId ? store.getObject(objectId) : undefined;
        if (object && (object.kind === 'text' || object.kind === 'sticky') && Number.isInteger(lineIndex)) {
          if (!isSoftLocked(ctx, [object.id], 'editing') && !isSoftLocked(ctx, [object.id], 'moving')) {
            const nextText = toggleCheckboxLine(object.text, lineIndex);
            if (nextText !== null && nextText !== object.text) {
              safeDispatch(store, [updateChange(object, { text: nextText })], 'Toggle checkbox', onNotice);
            }
          }
        }
        return;
      }
      const reactionTriggerEl = target.closest<HTMLElement>('[data-wb-reaction-trigger]');
      if (reactionTriggerEl && element.contains(reactionTriggerEl)) {
        event.preventDefault();
        event.stopPropagation();
        const objectId = reactionTriggerEl.dataset.wbReactionTrigger;
        const object = objectId ? store.getObject(objectId) : undefined;
        const container = reactionTriggerEl.closest<HTMLElement>('[data-wb-sticky-reactions]');
        const objectNode = reactionTriggerEl.closest<HTMLDivElement>('[data-wb-object-id]');
        closeOpenReactionPickers(container);
        if (object?.kind === 'sticky' && container && objectNode) {
          container.dataset.open = container.dataset.open === 'true' ? 'false' : 'true';
          paintObject(objectNode, object, session.getState().editingId === object.id, false, true);
        }
        return;
      }
      const reactionEl = target.closest<HTMLElement>('[data-wb-reaction]');
      if (reactionEl && element.contains(reactionEl)) {
        event.preventDefault();
        event.stopPropagation();
        const objectId = reactionEl.dataset.wbReactionObject;
        const emoji = reactionEl.dataset.wbReaction;
        const object = objectId ? store.getObject(objectId) : undefined;
        const container = reactionEl.closest<HTMLElement>('[data-wb-sticky-reactions]');
        const objectNode = reactionEl.closest<HTMLDivElement>('[data-wb-object-id]');
        closeOpenReactionPickers(container);
        if (container) container.dataset.open = 'false';
        if (object?.kind === 'sticky' && emoji) {
          if (isSoftLocked(ctx, [object.id], 'editing') || isSoftLocked(ctx, [object.id], 'moving')) {
            if (objectNode) paintObject(objectNode, object, session.getState().editingId === object.id, false, true);
            return;
          }
          const nextReactions = toggleStickyReaction(object.reactions, emoji, userId);
          if (nextReactions === null) {
            if (objectNode) paintObject(objectNode, object, session.getState().editingId === object.id, false, true);
            reportRefusal(onNotice, 'refused', 'Reaction limit reached on this note.');
          } else {
            safeDispatch(store, [updateChange(object, { reactions: nextReactions })], 'React to note', onNotice);
          }
        }
        return;
      }
    }
    closeOpenReactionPickers();
    const handleEl = target?.closest<HTMLElement>('[data-wb-handle]');
    const labelEl = target?.closest<HTMLElement>('[data-wb-frame-label]');
    const sample = sampleOf(event);
    lastPointer = sample.screen;
    // Take keyboard focus (this also blurs, and so commits, an open text editor).
    if (doc.activeElement !== element) element.focus({ preventScroll: true });
    if (event.button === 1) event.preventDefault(); // no autoscroll
    const gesture = beginGesture(ctx, {
      sample,
      button: event.button,
      handle: handleEl && element.contains(handleEl) ? asHandle(handleEl.dataset.wbHandle) : null,
      frameLabelId: labelEl && element.contains(labelEl) ? (labelEl.dataset.wbFrameLabel as ObjectId | undefined) ?? null : null,
      spaceHeld,
    });
    if (!gesture) return;
    event.preventDefault(); // no text selection / native drag while we own the gesture
    active = { pointerId: event.pointerId, gesture, last: sample };
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // jsdom / detached elements: window-level end handlers still finish the gesture.
    }
    updateCursor();
  }

  function onPointerMove(event: PointerEvent): void {
    const rect = bounds();
    lastPointer = screenOf(event, rect);
    const inside = lastPointer.x >= 0 && lastPointer.y >= 0 &&
      (rect.width === 0 || lastPointer.x < rect.width) && (rect.height === 0 || lastPointer.y < rect.height);
    presence?.send({ cursor: inside ? runtime.screenToWorld(lastPointer) : null });
    if (!active || event.pointerId !== active.pointerId) return;
    const sample = sampleOf(event, rect);
    let coalesced: PointerSample[] | undefined;
    if (active.gesture.kind === 'drawing' && typeof event.getCoalescedEvents === 'function') {
      coalesced = event.getCoalescedEvents().map(item => sampleOf(item, rect));
    }
    active.last = sample;
    active.gesture.move(sample, coalesced);
  }

  function onPointerLeave(): void {
    presence?.send({ cursor: null });
  }

  function onPointerUp(event: PointerEvent): void {
    if (!active || event.pointerId !== active.pointerId) return;
    finishActive(sampleOf(event));
  }

  function onPointerCancel(event: PointerEvent): void {
    if (active && event.pointerId === active.pointerId) cancelActive();
  }

  function onDoubleClick(event: MouseEvent): void {
    const target = event.target instanceof win.Element ? event.target : null;
    if (target?.closest('[data-wb-checkbox-line], [data-wb-sticky-reactions], [data-wb-reaction], [data-wb-reaction-trigger]')) {
      event.preventDefault();
      return;
    }
    if (blockedTarget(event.target) || active || event.button !== 0) return;
    if (handleDoubleClick(ctx, sampleOf(event).world)) event.preventDefault();
  }

  /* ------------------------------------------------------------ wheel/pinch */

  function onWheel(event: WheelEvent): void {
    if (blockedTarget(event.target)) {
      // Let popovers scroll, but never let a pinch zoom the whole webview.
      if (event.ctrlKey) event.preventDefault();
      return;
    }
    event.preventDefault();
    const rect = bounds();
    runtime.setCamera(cameraForWheel(runtime.getCamera(), event, screenOf(event, rect), rect.height || win.innerHeight));
    if (active) active.gesture.move((active.last = resample(active.last)));
  }

  function onGestureStart(event: Event): void {
    event.preventDefault();
    pinchStartZoom = runtime.getCamera().zoom;
  }

  function onGestureChange(event: Event): void {
    event.preventDefault();
    const gesture = event as GestureEventLike;
    if (pinchStartZoom === null || !Number.isFinite(gesture.scale) || blockedTarget(event.target)) return;
    const screen = screenOf(gesture);
    runtime.setCamera(zoomAt(runtime.getCamera(), screen, pinchStartZoom * gesture.scale));
    if (active) active.gesture.move((active.last = resample(active.last)));
  }

  function onGestureEnd(event: Event): void {
    event.preventDefault();
    pinchStartZoom = null;
  }

  /* --------------------------------------------------------------- keyboard */

  function keyboardBlocked(event: KeyboardEvent): boolean {
    return isComposing(event) || blockedTarget(event.target) || isGuardedElement(doc.activeElement);
  }

  function zoomToFit(): void {
    const rect = bounds();
    const visible = session.hasHiddenAuthors?.()
      ? store.getObjectsInRank().filter(object => !session.isAuthorHidden(object.createdBy))
      : store.getObjectsInRank();
    const camera = cameraToFit(visible, { x: 0, y: 0, w: rect.width, h: rect.height });
    if (camera) runtime.setCamera(camera);
  }

  function runAction(action: ShortcutAction): boolean {
    switch (action.type) {
      case 'tool':
        session.setTool(action.tool);
        return true;
      case 'image':
        onRequestImage?.();
        return true;
      case 'delete':
        deleteSelection(ctx);
        return true;
      case 'select-all':
        selectAll(ctx);
        return true;
      case 'duplicate':
        duplicateSelection(ctx);
        return true;
      case 'copy':
      case 'cut': {
        const copied = copySelection(ctx);
        if (copied) {
          clipboard = copied;
          pendingSystemText = copied.text;
          writeSystemClipboard(copied.text);
          if (action.type === 'cut') deleteSelection(ctx);
        }
        return false; // let the native copy/cut event fire too
      }
      case 'nudge':
        nudgeSelection(ctx, action.dx, action.dy);
        return true;
      case 'send-to-back':
        reorderSelection(ctx, false);
        return true;
      case 'bring-to-front':
        reorderSelection(ctx, true);
        return true;
      case 'undo':
        store.undo();
        return true;
      case 'redo':
        store.redo();
        return true;
      case 'zoom-to-fit':
        zoomToFit();
        return true;
      case 'escape': {
        if (closeOpenReactionPickers()) return true;
        const state = session.getState();
        if (state.selectedIds.length > 0) session.setSelectedIds([]);
        else if (state.tool !== 'select') session.setTool('select');
        return true;
      }
      case 'edit':
        return editSelection(ctx);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || keyboardBlocked(event)) return;
    if (event.key === ' ' || event.code === 'Space') {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); // no page scroll
        if (!spaceHeld) {
          spaceHeld = true;
          updateCursor();
        }
      }
      return;
    }
    if (active) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelActive();
      } else if (event.key === 'Shift') {
        active.gesture.move((active.last = resample(active.last, true)));
      }
      return;
    }
    const action = matchShortcut(event);
    if (action && runAction(action)) event.preventDefault();
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ' || event.code === 'Space') {
      spaceHeld = false;
      updateCursor();
      return;
    }
    if (active && event.key === 'Shift') active.gesture.move((active.last = resample(active.last, false)));
  }

  function onWindowBlur(): void {
    setDropping(false);
    cancelActive();
    onPointerLeave();
    spaceHeld = false;
    pinchStartZoom = null;
    updateCursor();
  }

  /* -------------------------------------------------------------- clipboard */

  function writeSystemClipboard(text: string): void {
    // Best effort for webviews where the copy event does not reach us.
    try {
      void win.navigator.clipboard?.writeText?.(text)?.catch(() => undefined);
    } catch {
      // Clipboard API unavailable or denied: the copy event path still applies.
    }
  }

  /** copy/cut events: the keydown already captured the objects (cut already deleted them). */
  function onCopy(event: ClipboardEvent): void {
    if (!boardFocused() || !event.clipboardData) return;
    let text = pendingSystemText;
    pendingSystemText = null;
    if (text === null) {
      // Copy from a menu (no keydown): capture the selection now.
      const copied = copySelection(ctx);
      if (!copied) return;
      clipboard = copied;
      text = copied.text;
    }
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  }

  function pastePoint(): Point | null {
    if (!lastPointer) return null;
    const rect = bounds();
    const outside = lastPointer.x < 0 || lastPointer.y < 0
      || (rect.width > 0 && lastPointer.x > rect.width) || (rect.height > 0 && lastPointer.y > rect.height);
    if (outside) return null;
    return runtime.screenToWorld(lastPointer);
  }

  function onPaste(event: ClipboardEvent): void {
    if (!boardFocused() || active) return;
    if (onImageFiles) {
      const images = filesOf(event.clipboardData, true);
      if (images.length > 0) {
        event.preventDefault();
        onImageFiles(images, pastePoint());
        return;
      }
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const at = pastePoint();
    if (clipboard && (text === clipboard.text || text === '')) {
      event.preventDefault();
      pasteObjects(ctx, clipboard, at);
      return;
    }
    if (text.trim() === '') return;
    event.preventDefault();
    const rect = bounds();
    pasteText(ctx, text, at ?? runtime.screenToWorld({ x: rect.width / 2, y: rect.height / 2 }));
  }

  /* -------------------------------------------------------------- file drop */

  let dragDepth = 0;

  function setDropping(on: boolean): void {
    if (!on) dragDepth = 0;
    if (on === element.hasAttribute('data-wb-dropping')) return;
    if (on) element.setAttribute('data-wb-dropping', '');
    else element.removeAttribute('data-wb-dropping');
  }

  function onDragEnter(event: DragEvent): void {
    if (event.defaultPrevented || !carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth++;
    setDropping(true);
  }

  function onDragOver(event: DragEvent): void {
    if (event.defaultPrevented || !carriesFiles(event.dataTransfer)) return;
    event.preventDefault(); // makes the board a drop target
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  }

  function onDragLeave(event: DragEvent): void {
    if (!carriesFiles(event.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDropping(false);
  }

  function onDrop(event: DragEvent): void {
    setDropping(false);
    if (event.defaultPrevented || !carriesFiles(event.dataTransfer)) return;
    // Always claim file drops: left alone, the webview would navigate to the file.
    event.preventDefault();
    const files = filesOf(event.dataTransfer, false);
    if (files.length > 0) onImageFiles?.(files, runtime.screenToWorld(screenOf(event)));
  }

  function onDragEnd(): void {
    setDropping(false);
  }

  /* ------------------------------------------------------------------ wiring */

  let visibility = session.getVisibilityState();
  const unsubscribeSession = session.subscribe((state, previous) => {
    const nextVisibility = session.getVisibilityState();
    if (nextVisibility !== visibility) {
      visibility = nextVisibility;
      // A gesture captures its original selection; do not let it commit or
      // restore objects that became hidden while it was in progress.
      cancelActive();
    }
    if (session.hasHiddenAuthors()) {
      const hidden = (id: ObjectId | null) => {
        const object = id ? store.getObject(id) : undefined;
        return !!object && session.isAuthorHidden(object.createdBy);
      };
      const selectedIds = state.selectedIds.filter(id => !hidden(id));
      const editingId = hidden(state.editingId) ? null : state.editingId;
      const croppingId = hidden(state.croppingId) ? null : state.croppingId;
      if (selectedIds.length !== state.selectedIds.length || editingId !== state.editingId || croppingId !== state.croppingId) {
        session.setState({ selectedIds, editingId, croppingId });
        return;
      }
    }
    if (state.tool !== previous.tool) updateCursor();
    if (state.selectedIds !== previous.selectedIds) presence?.send({ selectedIds: state.selectedIds });
    if (state.editingId !== previous.editingId) presence?.send({ editingId: state.editingId });
  });
  presence?.send({ selectedIds: session.getState().selectedIds, editingId: session.getState().editingId });

  const nonPassive: AddEventListenerOptions = { passive: false };
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerleave', onPointerLeave);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('lostpointercapture', onPointerCancel);
  element.addEventListener('dblclick', onDoubleClick);
  element.addEventListener('wheel', onWheel, nonPassive);
  element.addEventListener('gesturestart', onGestureStart, nonPassive);
  element.addEventListener('gesturechange', onGestureChange, nonPassive);
  element.addEventListener('gestureend', onGestureEnd, nonPassive);
  element.addEventListener('keydown', onKeyDown);
  element.addEventListener('keyup', onKeyUp);
  if (onImageFiles) {
    element.addEventListener('dragenter', onDragEnter);
    element.addEventListener('dragover', onDragOver);
    element.addEventListener('dragleave', onDragLeave);
    element.addEventListener('drop', onDrop);
    win.addEventListener('dragend', onDragEnd);
  }
  doc.addEventListener('copy', onCopy);
  doc.addEventListener('cut', onCopy);
  doc.addEventListener('paste', onPaste);
  win.addEventListener('blur', onWindowBlur);
  // A pointer released outside a capture-less element must still end the gesture.
  win.addEventListener('pointerup', onPointerUp);
  win.addEventListener('pointercancel', onPointerCancel);
  updateCursor();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelActive();
      presence?.send({ cursor: null, selectedIds: [], editingId: null, drag: null, laser: null });
      unsubscribeSession();
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerleave', onPointerLeave);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerCancel);
      element.removeEventListener('lostpointercapture', onPointerCancel);
      element.removeEventListener('dblclick', onDoubleClick);
      element.removeEventListener('wheel', onWheel, nonPassive);
      element.removeEventListener('gesturestart', onGestureStart, nonPassive);
      element.removeEventListener('gesturechange', onGestureChange, nonPassive);
      element.removeEventListener('gestureend', onGestureEnd, nonPassive);
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('keyup', onKeyUp);
      if (onImageFiles) {
        element.removeEventListener('dragenter', onDragEnter);
        element.removeEventListener('dragover', onDragOver);
        element.removeEventListener('dragleave', onDragLeave);
        element.removeEventListener('drop', onDrop);
        win.removeEventListener('dragend', onDragEnd);
      }
      setDropping(false);
      doc.removeEventListener('copy', onCopy);
      doc.removeEventListener('cut', onCopy);
      doc.removeEventListener('paste', onPaste);
      win.removeEventListener('blur', onWindowBlur);
      win.removeEventListener('pointerup', onPointerUp);
      win.removeEventListener('pointercancel', onPointerCancel);
      element.style.cursor = originalCursor;
      if (addedTabIndex) element.removeAttribute('tabindex');
    },
  };
}
