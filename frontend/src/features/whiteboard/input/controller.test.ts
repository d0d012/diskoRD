import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createInputController } from './controller';
import type { InputController } from './controller';
import { EMPTY_PREVIEW } from './objects';
import { setSnapGuides, snapState } from '../render/overlays/snapState';
import { USER, createHarness, imageObject, rectObject, textObject } from './testUtils';
import type { Harness } from './testUtils';

let element: HTMLDivElement;
let controller: InputController;
let h: Harness;

function setup(objects = [rectObject()]): void {
  h = createHarness(objects);
  element = document.createElement('div');
  element.className = 'wb-root';
  element.setAttribute('data-wb-viewport', '');
  document.body.appendChild(element);
  controller = createInputController({
    element, store: h.store, session: h.session, runtime: h.runtime, userId: USER,
  });
}

function pointer(type: string, x: number, y: number, init: PointerEventInit = {}, target: Element = element): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse', ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function keydown(key: string, init: KeyboardEventInit = {}, target: Element = element): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  controller?.dispose();
});

describe('input controller: snap guides', () => {
  const guide = { axis: 'x' as const, value: 10, from: 0, to: 50 };

  it('clears snap guides when a click-created sticky gesture ends', () => {
    setup([rectObject()]);
    h.session.setTool('sticky');
    pointer('pointerdown', 20, 20);
    setSnapGuides(h.runtime, [guide]);
    pointer('pointerup', 20, 20);
    expect(snapState(h.runtime).guides).toEqual([]);
  });

  it('clears snap guides when the gesture is cancelled', () => {
    setup([rectObject()]);
    h.session.setTool('rect');
    pointer('pointerdown', 20, 20);
    pointer('pointermove', 60, 60);
    setSnapGuides(h.runtime, [guide]);
    pointer('pointercancel', 60, 60);
    expect(snapState(h.runtime).guides).toEqual([]);
  });
});

describe('input controller: pointer gestures', () => {
  it('drag-creates a rect: preview during the drag, one dispatch on pointer-up', () => {
    setup([]);
    h.session.setTool('rect');
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 50, 40);
    pointer('pointermove', 110, 60);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.runtime.getPreview().objects).toHaveLength(1);
    pointer('pointerup', 110, 60);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.store.getObjectsInRank()[0]).toMatchObject({ kind: 'rect', x: 10, y: 10, w: 100, h: 50 });
    expect(h.runtime.getPreview()).toEqual(EMPTY_PREVIEW);
    expect(document.activeElement).toBe(element);
  });

  it.each(['pointercancel', 'lostpointercapture'])('%s ends the gesture cleanly without dispatching', type => {
    setup();
    const id = h.store.getObjectIds()[0];
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 80, 80);
    expect(h.runtime.getPreview().objects).toHaveLength(1);
    pointer(type, 80, 80);
    expect(h.runtime.getPreview()).toEqual(EMPTY_PREVIEW);
    pointer('pointerup', 80, 80);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.store.getObject(id)!.x).toBe(0);
  });

  it('window blur cancels the gesture', () => {
    setup();
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 80, 80);
    window.dispatchEvent(new Event('blur'));
    expect(h.runtime.getPreview()).toEqual(EMPTY_PREVIEW);
    pointer('pointerup', 80, 80);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('Escape cancels the gesture, then clears the selection, then returns to select', () => {
    setup();
    const id = h.store.getObjectIds()[0];
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 80, 80);
    keydown('Escape');
    expect(h.runtime.getPreview()).toEqual(EMPTY_PREVIEW);
    pointer('pointerup', 80, 80);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.session.getState().selectedIds).toEqual([id]);
    keydown('Escape');
    expect(h.session.getState().selectedIds).toEqual([]);
    h.session.setTool('pen');
    keydown('Escape');
    expect(h.session.getState().tool).toBe('select');
  });

  it('immediately prunes hidden selection, editing and cropping, and cancels captured drags', () => {
    const own = rectObject();
    const other = { ...rectObject(), id: 'other', createdBy: 'other-user', x: 500 };
    setup([own, other]);
    h.session.setSelectedIds([own.id, other.id]);
    h.session.setEditingId(other.id);
    h.session.setCroppingId(other.id);
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 80, 80);
    expect(h.runtime.getPreview().objects).toHaveLength(2);
    h.session.toggleHideAuthor('other-user');
    expect(h.session.getState()).toMatchObject({ selectedIds: [own.id], editingId: null, croppingId: null });
    expect(h.runtime.getPreview()).toEqual(EMPTY_PREVIEW);
    pointer('pointerup', 80, 80);
    expect(h.dispatch).not.toHaveBeenCalled();
    h.session.toggleSoloAuthor('other-user');
    expect(h.session.getState().selectedIds).toEqual([]);
    h.session.setSelectedIds([own.id, other.id]);
    expect(h.session.getState().selectedIds).toEqual([other.id]);
    h.session.showAllAuthors();
    expect(h.session.getState().selectedIds).toEqual([other.id]);
  });

  it('unsubscribes author visibility handling on disposal', () => {
    setup();
    const id = h.store.getObjectIds()[0];
    h.session.setSelectedIds([id]);
    controller.dispose();
    h.session.toggleHideAuthor(USER);
    expect(h.session.getState().selectedIds).toEqual([id]);
  });

  it('a second pointer never starts a parallel gesture', () => {
    setup([]);
    h.session.setTool('rect');
    pointer('pointerdown', 10, 10);
    pointer('pointerdown', 300, 300, { pointerId: 2 });
    pointer('pointermove', 60, 60);
    pointer('pointerup', 60, 60);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it('ignores pointer events inside data-wb-ui', () => {
    setup([]);
    h.session.setTool('rect');
    const ui = document.createElement('div');
    ui.setAttribute('data-wb-ui', '');
    const button = document.createElement('button');
    ui.appendChild(button);
    element.appendChild(ui);
    pointer('pointerdown', 10, 10, {}, button);
    pointer('pointerup', 10, 10, {}, button);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('reads handles from data-wb-handle on the target', () => {
    setup();
    const id = h.store.getObjectIds()[0];
    h.session.setSelectedIds([id]);
    const handle = document.createElement('div');
    handle.setAttribute('data-wb-handle', 'se');
    element.appendChild(handle);
    pointer('pointerdown', 100, 100, {}, handle);
    pointer('pointermove', 150, 120);
    pointer('pointerup', 150, 120);
    expect(h.store.getObject(id)).toMatchObject({ w: 150, h: 120 });
  });

  it('space-drag pans and dispatches nothing', () => {
    setup();
    keydown(' ', { code: 'Space' });
    expect(element.style.cursor).toBe('grab');
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 40, 30);
    pointer('pointerup', 40, 30);
    expect(h.runtime.getCamera()).toEqual({ x: 30, y: 20, zoom: 1 });
    expect(h.dispatch).not.toHaveBeenCalled();
    element.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
    expect(element.style.cursor).toBe('');
  });

  it('double-click on empty canvas creates and edits a text object', () => {
    setup([]);
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 30, clientY: 40 }));
    const [text] = h.store.getObjectsInRank();
    expect(text).toMatchObject({ kind: 'text', x: 30, y: 40 });
    expect(h.session.getState().editingId).toBe(text.id);
  });
});

describe('input controller: keyboard', () => {
  it('fires shortcuts when the canvas has focus', () => {
    setup();
    element.focus();
    keydown('r');
    expect(h.session.getState().tool).toBe('rect');
    keydown('a', { ctrlKey: true });
    expect(h.session.getState().selectedIds).toHaveLength(1);
    keydown('Delete');
    expect(h.store.getObjectIds()).toEqual([]);
  });

  it('never fires while an input, textarea, contenteditable or data-wb-ui element has focus', () => {
    setup();
    const id = h.store.getObjectIds()[0];
    h.session.setSelectedIds([id]);
    const ui = document.createElement('div');
    ui.setAttribute('data-wb-ui', '');
    const textarea = document.createElement('textarea');
    ui.appendChild(textarea);
    element.appendChild(ui);
    textarea.focus();
    keydown('Delete', {}, textarea);
    keydown('r', {}, textarea);
    // Even if the event is re-targeted at the canvas, focus decides.
    keydown('Delete');
    const input = document.createElement('input');
    element.appendChild(input);
    input.focus();
    keydown('Backspace', {}, input);
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    element.appendChild(editable);
    editable.focus();
    keydown('Delete', {}, editable);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.session.getState().tool).toBe('select');
    expect(h.store.getObject(id)).toBeDefined();
  });

  it('ignores keys during IME composition', () => {
    setup();
    h.session.setSelectedIds(h.store.getObjectIds());
    element.focus();
    keydown('Delete', { isComposing: true });
    keydown('Process');
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('undo and redo go through the store', () => {
    setup();
    const id = h.store.getObjectIds()[0];
    element.focus();
    h.session.setSelectedIds([id]);
    keydown('ArrowRight', { shiftKey: true });
    expect(h.store.getObject(id)!.x).toBe(10);
    h.ackAll();
    keydown('z', { metaKey: true });
    expect(h.store.getObject(id)!.x).toBe(0);
    h.ackAll();
    keydown('z', { ctrlKey: true, shiftKey: true });
    expect(h.store.getObject(id)!.x).toBe(10);
  });

  it('Enter edits a selected text object', () => {
    const t = textObject();
    setup([t]);
    h.session.setSelectedIds([t.id]);
    element.focus();
    expect(keydown('Enter').defaultPrevented).toBe(true);
    expect(h.session.getState().editingId).toBe(t.id);
  });
});

describe('input controller: wheel, pinch, clipboard, dispose', () => {
  it('wheel uses a non-passive listener: pans, and ctrl-wheel zooms around the cursor', () => {
    setup();
    const pan = new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true });
    element.dispatchEvent(pan);
    expect(pan.defaultPrevented).toBe(true);
    expect(h.runtime.getCamera()).toMatchObject({ y: -30, zoom: 1 });
    expect(h.runtime.getCamera().x + 0).toBe(0);
    const zoom = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: 200, clientY: 100, bubbles: true, cancelable: true });
    element.dispatchEvent(zoom);
    const camera = h.runtime.getCamera();
    expect(camera.zoom).toBeGreaterThan(1);
    expect((200 - camera.x) / camera.zoom).toBeCloseTo(200);
    expect((100 - camera.y) / camera.zoom).toBeCloseTo(130);
  });

  it('suppresses Safari gesture events and zooms with their scale', () => {
    setup();
    const start = new Event('gesturestart', { cancelable: true, bubbles: true });
    element.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
    const change = Object.assign(new Event('gesturechange', { cancelable: true, bubbles: true }), {
      scale: 2, clientX: 0, clientY: 0,
    });
    element.dispatchEvent(change);
    expect(change.defaultPrevented).toBe(true);
    expect(h.runtime.getCamera().zoom).toBe(2);
  });

  it('pastes plain text as a text object at the cursor, and copied objects as copies', () => {
    setup();
    const id = h.store.getObjectIds()[0];
    element.focus();
    pointer('pointermove', 300, 200);
    const paste = (text: string) => {
      const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: { getData: () => text },
      });
      element.dispatchEvent(event);
      return event;
    };
    expect(paste('hello').defaultPrevented).toBe(true);
    const text = h.store.getObjectsInRank().find(object => object.kind === 'text')!;
    expect(text).toMatchObject({ x: 300, y: 200, text: 'hello' });

    h.session.setSelectedIds([id]);
    keydown('c', { ctrlKey: true });
    paste('');
    const copies = h.store.getObjectsInRank().filter(object => object.kind === 'rect');
    expect(copies).toHaveLength(2);
  });

  it('removes every listener on dispose', () => {
    setup([]);
    const removeElement = vi.spyOn(element, 'removeEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    controller.dispose();
    expect(removeElement.mock.calls.map(call => call[0]).sort()).toEqual([
      'dblclick', 'gesturechange', 'gestureend', 'gesturestart', 'keydown', 'keyup', 'lostpointercapture',
      'pointercancel', 'pointerdown', 'pointerleave', 'pointermove', 'pointerup', 'wheel',
    ]);
    expect(removeWindow.mock.calls.map(call => call[0]).sort()).toEqual(['blur', 'pointercancel', 'pointerup']);
    expect(removeDocument.mock.calls.map(call => call[0]).sort()).toEqual(['copy', 'cut', 'paste']);
    h.session.setTool('rect');
    pointer('pointerdown', 10, 10);
    pointer('pointerup', 100, 100);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(element.hasAttribute('tabindex')).toBe(false);
  });
});

describe('input controller: images', () => {
  let onImageFiles: Mock<(files: readonly Blob[], at: { x: number; y: number } | null) => void>;
  let onRequestImage: Mock<() => void>;

  function setupImages(objects = [imageObject({ x: 100, y: 100, w: 100, h: 50 })]): void {
    h = createHarness(objects);
    element = document.createElement('div');
    element.className = 'wb-root';
    element.setAttribute('data-wb-viewport', '');
    document.body.appendChild(element);
    onImageFiles = vi.fn();
    onRequestImage = vi.fn();
    controller = createInputController({
      element, store: h.store, session: h.session, runtime: h.runtime, userId: USER, onImageFiles, onRequestImage,
    });
  }

  const png = () => new File(['x'], 'a.png', { type: 'image/png' });

  function paste(data: Record<string, unknown>): Event {
    const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), { clipboardData: data });
    element.dispatchEvent(event);
    return event;
  }

  function drag(type: string, files: File[], extra: Record<string, unknown> = {}): Event {
    const dataTransfer = { types: files.length ? ['Files'] : ['text/plain'], files, dropEffect: 'none' };
    const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer, clientX: 0, clientY: 0, ...extra });
    element.dispatchEvent(event);
    return event;
  }

  it('routes pasted image files (not text) to onImageFiles at the pointer', () => {
    setupImages();
    element.focus();
    pointer('pointermove', 300, 200);
    const file = png();
    const event = paste({ files: [file], getData: () => '' });
    expect(event.defaultPrevented).toBe(true);
    expect(onImageFiles).toHaveBeenCalledExactlyOnceWith([file], { x: 300, y: 200 });
  });

  it('reads image files from clipboard items when files is empty, and reports no pointer as null', () => {
    setupImages();
    element.focus();
    const file = png();
    paste({ files: [], items: [{ kind: 'file', getAsFile: () => file }, { kind: 'string', getAsFile: () => null }], getData: () => '' });
    expect(onImageFiles).toHaveBeenCalledExactlyOnceWith([file], null);
  });

  it('keeps text paste as it was, and ignores non-image files', () => {
    setupImages();
    element.focus();
    pointer('pointermove', 30, 40);
    paste({ files: [], getData: () => 'hello' });
    expect(onImageFiles).not.toHaveBeenCalled();
    expect(h.store.getObjectsInRank().find(object => object.kind === 'text')).toMatchObject({ text: 'hello' });
    paste({ files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })], getData: () => '' });
    expect(onImageFiles).not.toHaveBeenCalled();
  });

  it('does nothing for paste when the board is not focused', () => {
    setupImages();
    paste({ files: [png()], getData: () => '' });
    expect(onImageFiles).not.toHaveBeenCalled();
  });

  it('shows the drop hint on dragover, claims the drop and routes files at the drop point', () => {
    setupImages();
    h.runtime.setCamera({ x: 0, y: 0, zoom: 2 });
    const over = drag('dragover', [png()]);
    expect(over.defaultPrevented).toBe(true);
    expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy');
    expect(element.hasAttribute('data-wb-dropping')).toBe(true);
    const file = png();
    const drop = drag('drop', [file], { clientX: 100, clientY: 60 });
    expect(drop.defaultPrevented).toBe(true);
    expect(element.hasAttribute('data-wb-dropping')).toBe(false);
    expect(onImageFiles).toHaveBeenCalledExactlyOnceWith([file], { x: 50, y: 30 });
  });

  it('clears the drop hint when the drag leaves, and ignores drags without files', () => {
    setupImages();
    drag('dragenter', [png()]);
    drag('dragover', [png()]);
    expect(element.hasAttribute('data-wb-dropping')).toBe(true);
    drag('dragleave', [png()]);
    expect(element.hasAttribute('data-wb-dropping')).toBe(false);
    const text = drag('dragover', []);
    expect(text.defaultPrevented).toBe(false);
    expect(element.hasAttribute('data-wb-dropping')).toBe(false);
    drag('drop', []);
    expect(onImageFiles).not.toHaveBeenCalled();
  });

  it('double-click on an image crops it; Enter on a selected image too', () => {
    setupImages();
    const [image] = h.store.getObjectsInRank();
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 120, clientY: 120 }));
    expect(h.session.getState().croppingId).toBe(image.id);
    expect(h.session.getState().selectedIds).toEqual([image.id]);
    expect(h.session.getState().editingId).toBeNull();
    h.session.setCroppingId(null);
    element.focus();
    keydown('Enter');
    expect(h.session.getState().croppingId).toBe(image.id);
  });

  it('the I shortcut requests the picker', () => {
    setupImages();
    element.focus();
    keydown('i');
    expect(onRequestImage).toHaveBeenCalledOnce();
  });
});
