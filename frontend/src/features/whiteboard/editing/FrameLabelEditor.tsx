import { useLayoutEffect, useRef } from 'react';
import type { BoardStore, SyncAdapter, UserId } from '../contract';
import { MAX_FRAME_LABEL_LENGTH } from '../contract/limits';
import type { SessionStore } from '../state/sessionStore';
import type { BoardNotify } from '../state/notices';
import './frameLabelEditor.css';

interface FrameLabelEditorProps {
  store: BoardStore;
  session: SessionStore;
  adapter?: SyncAdapter | null;
  selfUserId: UserId;
  onNotice?: BoardNotify;
}

/** Delegated capture listeners leave single-click selection/drag entirely to the controller. */
export function FrameLabelEditor({ store, session, adapter, selfUserId, onNotice }: FrameLabelEditorProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const viewport = anchor.current?.closest<HTMLElement>('[data-wb-viewport]');
    if (!viewport) return;
    let cancel: (() => void) | undefined;

    function begin(id: string): void {
      if (session.getState().editingId !== null || cancel) return;
      const initial = store.getObject(id);
      const label = Array.from(viewport!.querySelectorAll<HTMLElement>('[data-wb-frame-label]'))
        .find(node => node.dataset.wbFrameLabel === id);
      if (initial?.kind !== 'frame' || !label || session.isAuthorHidden(initial.createdBy)) return;
      const owner = adapter?.getPresence().find(p => p.userId !== selfUserId && p.editingId === id);
      if (owner) { onNotice?.('refused', `${owner.name} is editing this`); return; }
      const oldLabel = initial.label;
      session.setSelectedIds([id]);
      session.setEditingId(id);
      label.dataset.wbRenaming = '';
      const title = label.querySelector<HTMLElement>('[data-wb-frame-title]')!;
      const input = label.ownerDocument.createElement('input');
      input.className = 'wb-frame-label-input';
      input.dataset.wbUi = '';
      input.setAttribute('aria-label', 'Frame name');
      input.value = initial.label;
      // The contract counts Unicode scalars, whereas HTML maxLength counts UTF-16 units.
      input.addEventListener('input', () => {
        if (!composing) input.value = Array.from(input.value.replace(/\0/g, '')).slice(0, MAX_FRAME_LABEL_LENGTH).join('');
      });
      input.style.left = `${title.offsetLeft}px`;
      let composing = false;
      input.addEventListener('compositionstart', () => { composing = true; });
      input.addEventListener('compositionend', () => { composing = false; });
      let finished = false;
      let unsubscribe = () => {};
      function finish(commit: boolean, restoreFocus = false): void {
        if (finished) return;
        finished = true;
        unsubscribe();
        cancel = undefined;
        const current = store.getObject(id);
        const value = Array.from(input.value.replace(/[\r\n\0]/g, '').trim()).slice(0, MAX_FRAME_LABEL_LENGTH).join('');
        input.remove();
        delete label!.dataset.wbRenaming;
        if (session.getState().editingId === id) session.setEditingId(null);
        if (commit && value && current?.kind === 'frame' && current.label === oldLabel && value !== current.label) {
          store.dispatch([{ id, action: 'update', expectedVersion: current.version, patch: { label: value } }], { label: 'Rename frame' });
        }
        if (restoreFocus) viewport!.focus({ preventScroll: true });
      }
      cancel = () => finish(false);
      input.addEventListener('keydown', event => {
        event.stopPropagation();
        if (composing || event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape' || event.key === 'Enter') {
          event.preventDefault();
          finish(event.key === 'Enter', true);
        }
      });
      input.addEventListener('blur', () => finish(true));
      unsubscribe = store.subscribeObject(id, () => {
        const current = store.getObject(id);
        if (current?.kind !== 'frame' || current.label !== initial.label) finish(false);
      });
      label.append(input);
      input.focus({ preventScroll: true });
      input.select();
    }

    function doubleClick(event: MouseEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, [data-wb-ui]')) return;
      const label = target?.closest<HTMLElement>('[data-wb-frame-label]');
      if (!label || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      begin(label.dataset.wbFrameLabel!);
    }
    function keyDown(event: KeyboardEvent): void {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        target?.closest('input, textarea, select, [contenteditable="true"], [data-wb-ui]')) return;
      const ids = session.getState().selectedIds;
      if ((event.key === 'Enter' || event.key === 'F2') && ids.length === 1 && store.getObject(ids[0])?.kind === 'frame') {
        event.preventDefault();
        event.stopImmediatePropagation();
        begin(ids[0]);
      }
    }
    const unsubscribeSession = session.subscribe(state => {
      if (cancel && (state.editingId === null || state.selectedIds.length !== 1 || state.selectedIds[0] !== state.editingId)) cancel();
    });
    viewport.addEventListener('dblclick', doubleClick, true);
    viewport.addEventListener('keydown', keyDown, true);
    return () => {
      cancel?.();
      unsubscribeSession();
      viewport.removeEventListener('dblclick', doubleClick, true);
      viewport.removeEventListener('keydown', keyDown, true);
    };
  }, [store, session, adapter, selfUserId, onNotice]);
  return <span ref={anchor} hidden />;
}
