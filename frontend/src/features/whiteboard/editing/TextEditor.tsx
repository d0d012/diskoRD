import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { useStore } from 'zustand';
import type {
  BoardObject, BoardStore, Change, Runtime, StickyObject, TextObject,
} from '../contract';
import {
  MAX_STICKY_TEXT_LENGTH, MAX_TEXT_LENGTH, STICKY_BASE_HEIGHT, TEXT_COMMIT_DEBOUNCE_MS,
} from '../contract/limits';
import { continueCheckboxOnEnter, isHexColour, resolveStickyToneCss } from '../core';
import type { SessionStore } from '../state/sessionStore';
import type { BoardNotify } from '../state/notices';
import { createDomTextMeasurer, fitSticky, fitText, STICKY_LINE_HEIGHT, STICKY_PADDING, TEXT_LINE_HEIGHT } from './measure';
import type { TextMeasurer } from './measure';

export interface TextEditorProps {
  readonly store: BoardStore;
  readonly session: SessionStore;
  readonly runtime: Runtime;
  /** Injectable for tests; defaults to a DOM-backed measurer. */
  readonly measurer?: TextMeasurer;
  /** A refused text commit is reported here (and always warned in development). */
  readonly onNotice?: BoardNotify;
}

type Editable = TextObject | StickyObject;

function isEditable(object: BoardObject | undefined): object is Editable {
  return object?.kind === 'text' || object?.kind === 'sticky';
}

function sanitize(raw: string, max: number): string {
  const clean = raw.replace(/\r\n?/g, '\n').replace(/\0/g, '');
  const scalars = Array.from(clean);
  return scalars.length > max ? scalars.slice(0, max).join('') : clean;
}

function colourVar(colour: string): string {
  if (isHexColour(colour)) return colour;
  return colour === 'ink' ? 'var(--wb-colour-ink, var(--color-dc-text-normal, #dbdee1))' : `var(--wb-colour-${colour})`;
}

export function TextEditor(props: TextEditorProps): ReactElement | null {
  const { store, session } = props;
  const editingId = useStore(session, state => state.editingId);
  const initial = editingId === null ? undefined : store.getObject(editingId);
  const usable = isEditable(initial);
  useEffect(() => {
    // Nothing editable behind the id (deleted, wrong kind): drop the stale session state.
    if (editingId !== null && !usable && session.getState().editingId === editingId) session.setEditingId(null);
  }, [editingId, usable, session]);
  if (editingId === null || !usable) return null;
  return <EditorSurface key={editingId} {...props} initial={initial} />;
}

interface SurfaceProps extends TextEditorProps {
  readonly initial: Editable;
}

function EditorSurface({ store, session, runtime, measurer, onNotice, initial }: SurfaceProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const handlers = useRef<{
    input(): void; keyDown(event: React.KeyboardEvent): void; blur(): void;
    compositionStart(): void; compositionEnd(): void;
  } | null>(null);
  const id = initial.id;

  useLayoutEffect(() => {
    const root = rootRef.current!;
    const wrap = wrapRef.current!;
    const area = areaRef.current!;
    const doc = root.ownerDocument;
    const ownMeasurer = measurer ? null : createDomTextMeasurer(root);
    const measure: TextMeasurer = measurer ?? ownMeasurer!;
    const maxLength = initial.kind === 'sticky' ? MAX_STICKY_TEXT_LENGTH : MAX_TEXT_LENGTH;
    const minStickyHeight = Math.min(initial.h, STICKY_BASE_HEIGHT);
    const justCreated = initial.version === 0;
    let height = initial.h;
    let composing = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frame = 0;

    function current(): Editable | undefined {
      const object = store.getObject(id);
      return isEditable(object) ? object : undefined;
    }
    function layoutFor(object: Editable, text: string): { fontSize: number; height: number } {
      if (object.kind === 'sticky') {
        const fit = fitSticky(measure, { text, width: object.w, minHeight: minStickyHeight });
        return { fontSize: fit.fontSize, height: fit.height };
      }
      return fitText(measure, {
        text, width: object.w, size: object.style.size, bold: object.style.bold, italic: object.style.italic,
      });
    }
    function applyTransform(): void {
      const object = current();
      if (!object) return;
      const origin = runtime.worldToScreen({ x: object.x, y: object.y });
      wrap.style.transform = `translate(${origin.x}px, ${origin.y}px) scale(${runtime.getCamera().zoom})`;
    }
    function applyLayout(): void {
      const object = current();
      if (!object) return;
      const layout = layoutFor(object, area.value);
      height = layout.height;
      wrap.style.width = `${object.w}px`;
      wrap.style.height = `${height}px`;
      area.style.fontSize = `${layout.fontSize}px`;
      if (object.kind === 'sticky') {
        area.style.fontFamily = 'var(--wb-font-handwriting, "Caveat", cursive)';
        area.style.fontWeight = '700';
        area.style.fontStyle = 'normal';
        area.style.textAlign = 'left';
        area.style.lineHeight = String(STICKY_LINE_HEIGHT);
        area.style.padding = `${STICKY_PADDING}px`;
        area.style.color = resolveStickyToneCss(object.style.tone).ink;
      } else {
        area.style.fontFamily = 'var(--wb-font-ui, sans-serif)';
        area.style.fontWeight = object.style.bold ? '700' : '400';
        area.style.fontStyle = object.style.italic ? 'italic' : 'normal';
        area.style.textAlign = object.style.align;
        area.style.lineHeight = String(TEXT_LINE_HEIGHT);
        area.style.padding = '0';
        area.style.color = colourVar(object.style.colour);
      }
      applyTransform();
    }
    function clearTimer(): void {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    }
    function dispatch(changes: readonly Change[], label: string): void {
      try {
        store.dispatch(changes, { label });
      } catch (error) {
        if (import.meta.env.DEV) console.warn('whiteboard: text commit refused', error);
        onNotice?.('refused', 'That text change could not be saved.');
      }
    }
    /** Writes the editor's text (and its measured height) to the store. `final` additionally deletes an empty text object. */
    function commit(final: boolean): void {
      const object = current();
      if (!object) return;
      const text = sanitize(area.value, maxLength);
      if (text === '' && object.kind === 'text') {
        if (final) dispatch([{ id, action: 'delete', expectedVersion: object.version }], 'Delete empty text');
        return;
      }
      const nextHeight = layoutFor(object, text).height;
      if (text === object.text && nextHeight === object.h) return;
      dispatch([{ id, action: 'update', expectedVersion: object.version, patch: { text, h: nextHeight } }], 'Edit text');
    }
    function schedule(): void {
      clearTimer();
      if (composing) return;
      timer = setTimeout(() => { timer = null; if (!finished && !composing) commit(false); }, TEXT_COMMIT_DEBOUNCE_MS);
    }
    function finish(refocus: boolean): void {
      if (finished) return;
      finished = true;
      clearTimer();
      commit(true);
      const viewport = root.closest<HTMLElement>('[data-wb-viewport]');
      if (session.getState().editingId === id) session.setEditingId(null);
      if (refocus) viewport?.focus({ preventScroll: true });
    }

    handlers.current = {
      input() {
        const cleaned = sanitize(area.value, maxLength);
        if (cleaned !== area.value) {
          const caret = Math.min(area.selectionStart, cleaned.length);
          area.value = cleaned;
          area.setSelectionRange(caret, caret);
        }
        applyLayout();
        schedule();
      },
      keyDown(event) {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
          const continued = continueCheckboxOnEnter(area.value, area.selectionStart, area.selectionEnd);
          if (continued) {
            event.preventDefault();
            const cleaned = sanitize(continued.text, maxLength);
            area.value = cleaned;
            const caret = Math.min(continued.caret, cleaned.length);
            area.setSelectionRange(caret, caret);
            applyLayout();
            schedule();
          }
        }
        // Tab keeps its default focus move; the resulting blur finishes the edit.
      },
      blur() {
        composing = false;
        finish(false);
      },
      compositionStart() { composing = true; clearTimer(); },
      compositionEnd() { composing = false; schedule(); },
    };

    // Escape / Ctrl+Enter must close the editor even when focus never reached
    // the textarea (the editor mounted for a just-placed object and the
    // browser kept focus on the viewport). Capture at the document so this
    // always wins over the input controller's own Escape handling, which would
    // otherwise clear the selection but leave editingId set.
    function onKeyDown(event: KeyboardEvent): void {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      }
    }
    doc.addEventListener('keydown', onKeyDown, true);

    applyLayout();
    area.focus({ preventScroll: true });
    if (justCreated) area.select();
    else area.setSelectionRange(area.value.length, area.value.length);

    const offObject = store.subscribeObject(id, () => {
      if (finished) return;
      if (!current()) { // deleted remotely: close without writing
        finished = true;
        clearTimer();
        if (session.getState().editingId === id) session.setEditingId(null);
        return;
      }
      applyLayout();
    });
    const offCamera = runtime.subscribeCamera(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; applyTransform(); });
    });
    // Pointer handlers that preventDefault would suppress blur, so close on any outside press too.
    const onOutside = (event: Event): void => {
      if (event.target instanceof Node && !root.contains(event.target)) finish(false);
    };
    doc.addEventListener('pointerdown', onOutside, true);
    void doc.fonts?.ready.then(() => { if (!finished) applyLayout(); });

    return () => {
      offObject();
      offCamera();
      doc.removeEventListener('pointerdown', onOutside, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      if (frame) cancelAnimationFrame(frame);
      clearTimer();
      // Unmounted without finishing (id switched externally): flush edits, never delete.
      if (!finished) { finished = true; commit(false); }
      ownMeasurer?.dispose();
      handlers.current = null;
    };
    // The surface is keyed by object id; its collaborators are stable for the board's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      data-wb-ui=""
      data-wb-text-editor=""
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      <div
        ref={wrapRef}
        style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', willChange: 'transform' }}
      >
        <textarea
          ref={areaRef}
          defaultValue={initial.text}
          rows={1}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={initial.kind === 'sticky' ? 'Edit note' : 'Edit text'}
          onInput={() => handlers.current?.input()}
          onKeyDown={event => handlers.current?.keyDown(event)}
          onBlur={() => handlers.current?.blur()}
          onCompositionStart={() => handlers.current?.compositionStart()}
          onCompositionEnd={() => handlers.current?.compositionEnd()}
          style={{
            display: 'block', boxSizing: 'border-box', width: '100%', height: '100%', margin: 0, border: 0,
            outline: 'none', resize: 'none', overflow: 'hidden', background: 'transparent',
            whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal', pointerEvents: 'auto',
            caretColor: 'currentColor',
          }}
        />
      </div>
    </div>
  );
}
