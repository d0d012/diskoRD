import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import { useAuthStore } from '../../../stores/authStore';
import { MAX_CHANGES_PER_COMMAND, PALETTE_COLOURS, STICKY_REACTION_PRESETS, STICKY_TONES, STROKE_WEIGHTS } from '../contract';
import type { BoardObject, Change, ObjectPatch, StickyObject } from '../contract';
import {
  bringToFront, getBounds, isHexColour, normalizeHexColour, pickerHexForColour,
  pickerHexForStickyTone, sendToBack, toggleStickyReaction, unionBounds,
} from '../core';
import { BoardIcon } from './icons';
import { textObjectHeight } from '../editing/measure';
import type { BoardNotify } from '../state';
import type { BoardUIProps } from './Toolbar';

type StyleField = 'colour' | 'weight' | 'fill' | 'size' | 'bold' | 'italic' | 'align' | 'tone';

interface StyleBarProps extends BoardUIProps {
  /** Refused actions are reported here (the board's notice channel), never inline. */
  readonly notify?: BoardNotify;
}

export function StyleBar({ store, session, runtime, notify }: StyleBarProps) {
  const selectedIds = useStore(session, state => state.selectedIds);
  const subscribe = useCallback((listener: () => void) => {
    const stops = [store.subscribeIds(listener), ...selectedIds.map(id => store.subscribeObject(id, listener))];
    return () => stops.forEach(stop => stop());
  }, [store, selectedIds]);
  const objects = useSyncExternalStore(subscribe, store.getObjectsInRank);
  const selected = objects.filter(object => selectedIds.includes(object.id));
  const root = useRef<HTMLDivElement>(null);
  const reactAnchorRef = useRef<HTMLDivElement>(null);
  const selectionKey = selectedIds.join(',');
  const [reactOpenFor, setReactOpenFor] = useState<string | null>(null);
  const reactOpen = reactOpenFor === selectionKey;
  const colourTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (colourTimerRef.current !== null) clearTimeout(colourTimerRef.current);
  }, []);
  useEffect(() => {
    if (!reactOpen) return;
    function onDown(event: PointerEvent) {
      if (reactAnchorRef.current && event.target instanceof Node && !reactAnchorRef.current.contains(event.target)) {
        setReactOpenFor(null);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setReactOpenFor(null);
    }
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [reactOpen]);

  useEffect(() => {
    let frame = 0;
    const element = root.current;
    if (!element) return;
    function draw() {
      frame = 0;
      if (!element) return;
      const preview = runtime.getPreview();
      const current = selectedIds.flatMap(id => {
        if (preview.hiddenIds.includes(id)) return [];
        const object = preview.objects.find(item => item.id === id) ?? store.getObject(id);
        return object ? [object] : [];
      });
      element.style.visibility = current.length ? 'visible' : 'hidden';
      if (!current.length) return;
      const bounds = unionBounds(current.map(getBounds));
      const anchor = runtime.worldToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y });
      const viewport = element.closest<HTMLElement>('[data-wb-viewport]');
      const width = viewport?.clientWidth ?? 0;
      const x = Math.max(element.offsetWidth / 2 + 8, Math.min(width - element.offsetWidth / 2 - 8, anchor.x));
      element.style.transform = `translate(${x}px, ${Math.max(element.offsetHeight + 8, anchor.y - 12)}px) translate(-50%, -100%)`;
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
    const stops = [runtime.subscribeCamera(schedule), runtime.subscribePreview(schedule), subscribe(schedule)];
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    const viewport = element.closest('[data-wb-viewport]');
    if (viewport) observer.observe(viewport);
    schedule();
    return () => { stops.forEach(stop => stop()); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [runtime, store, selectedIds, subscribe, objects]);

  if (!selected.length) return null;
  const supports = (field: StyleField) => selected.every(object => 'style' in object && field in object.style);
  function value(field: StyleField): string {
    const values = selected.map(object => 'style' in object && field in object.style ? String(object.style[field as keyof typeof object.style]) : '');
    return values.every(item => item === values[0]) ? values[0] : '';
  }
  function dispatch(changes: Change[], label: string): boolean {
    if (changes.length > MAX_CHANGES_PER_COMMAND) {
      notify?.('too-many-changes', `Too many objects selected for one action (at most ${MAX_CHANGES_PER_COMMAND}).`);
      if (import.meta.env.DEV) console.warn('whiteboard: style change refused: too many changes');
      return false;
    }
    try {
      store.dispatch(changes, { label });
      return true;
    } catch (cause) {
      notify?.('refused', 'That change could not be applied.');
      if (import.meta.env.DEV) console.warn('whiteboard: style change refused', cause);
      return false;
    }
  }
  function style(field: StyleField, next: string | boolean) {
    dispatch(selected.map(object => {
      const nextStyle = { ...('style' in object ? object.style : {}), [field]: next };
      // Size/bold/italic change the wrapped text height: keep the persisted h in step.
      const patch = object.kind === 'text'
        ? { style: nextStyle, h: textObjectHeight({ text: object.text, w: object.w, style: nextStyle as typeof object.style }) }
        : { style: nextStyle };
      return { id: object.id, action: 'update', expectedVersion: object.version, patch: patch as ObjectPatch };
    }), 'Change style');
  }
  function preset(next: 'pen' | 'marker') {
    dispatch(selected.map(object => ({ id: object.id, action: 'update', expectedVersion: object.version, patch: { preset: next } })), 'Change stroke preset');
  }
  function reorder(front: boolean) {
    let ranks;
    try {
      ranks = (front ? bringToFront : sendToBack)(selected, store.getObjectsInRank());
    } catch (cause) {
      notify?.('refused', 'Rank space exhausted.');
      if (import.meta.env.DEV) console.warn('whiteboard: reorder refused', cause);
      return;
    }
    dispatch(selected.map((object, i) => ({ id: object.id, action: 'update', expectedVersion: object.version, patch: { rank: ranks[i] } })), front ? 'Bring to front' : 'Send to back');
  }
  function select(field: StyleField, label: string, choices: readonly string[]) {
    return <label className="wb-ui-select-label">{label}<select aria-label={label} value={value(field)} onChange={event => style(field, event.target.value)}>
      <option value="" disabled>Mixed</option>{choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </select></label>;
  }
  function toggle(field: 'bold' | 'italic', label: string) {
    return <button type="button" aria-label={label} aria-pressed={value(field) === 'true'} onClick={() => style(field, value(field) !== 'true')}>{field === 'bold' ? <b>B</b> : <i>I</i>}</button>;
  }
  function styleDebounced(field: StyleField, next: string) {
    if (colourTimerRef.current !== null) clearTimeout(colourTimerRef.current);
    colourTimerRef.current = setTimeout(() => {
      colourTimerRef.current = null;
      const latest = session.getState().selectedIds.flatMap(id => {
        const obj = store.getObject(id);
        return obj ? [obj] : [];
      });
      if (!latest.length) return;
      dispatch(latest.map(object => {
        const nextStyle = { ...('style' in object ? object.style : {}), [field]: next };
        const patch = object.kind === 'text'
          ? { style: nextStyle, h: textObjectHeight({ text: object.text, w: object.w, style: nextStyle as typeof object.style }) }
          : { style: nextStyle };
        return { id: object.id, action: 'update', expectedVersion: object.version, patch: patch as ObjectPatch };
      }), 'Change style');
    }, 150);
  }
  function react(emoji: string) {
    const stickies = selected.filter((object): object is StickyObject => object.kind === 'sticky');
    if (!stickies.length) return;
    const actor = store.getUserId?.() ?? useAuthStore.getState().user?.id;
    if (!actor) return;
    const changes: Change[] = [];
    for (const object of stickies) {
      const next = toggleStickyReaction(object.reactions, emoji, actor);
      if (next === null) {
        notify?.('refused', 'Reaction limit reached on this note.');
        return;
      }
      changes.push({ id: object.id, action: 'update', expectedVersion: object.version, patch: { reactions: next } });
    }
    dispatch(changes, 'React to note');
  }
  const currentColour = value('colour');
  const currentTone = value('tone');
  return <div data-wb-ui ref={root} className="wb-root__style-bar wb-ui-style" role="toolbar" aria-label="Selection style">
    {supports('colour') && <div className="wb-ui-palette" role="group" aria-label="Ink colour">
      {PALETTE_COLOURS.map(colour => <button type="button" key={colour} className="wb-ui-colour" title={colour} aria-label={`${colour} ink`} aria-pressed={currentColour === colour}
        style={{ background: `var(--wb-colour-${colour})` }} onClick={() => {
          style('colour', colour);
          const defaults = session.getState().styleDefaults;
          session.setStyleDefaults({ stroke: { ...defaults.stroke, colour }, shape: { ...defaults.shape, colour }, text: { ...defaults.text, colour }, frame: { ...defaults.frame, colour } });
        }} />)}
      <label className="wb-ui-colour wb-ui-colour-picker" title="Custom ink colour" data-active={String(isHexColour(currentColour))} style={{ background: isHexColour(currentColour) ? currentColour : undefined }}>
        <input type="color" aria-label="Custom ink colour" value={pickerHexForColour(currentColour || 'ink')} onChange={event => {
          const hex = normalizeHexColour(event.target.value);
          if (!hex) return;
          styleDebounced('colour', hex);
          const defaults = session.getState().styleDefaults;
          session.setStyleDefaults({ stroke: { ...defaults.stroke, colour: hex }, shape: { ...defaults.shape, colour: hex }, text: { ...defaults.text, colour: hex }, frame: { ...defaults.frame, colour: hex } });
        }} />
      </label>
    </div>}
    {supports('fill') && select('fill', 'Fill', ['none', 'tint', 'solid'])}
    {supports('weight') && select('weight', 'Weight', [...STROKE_WEIGHTS])}
    {selected.every(object => object.kind === 'stroke') && <label className="wb-ui-select-label">Preset<select aria-label="Stroke preset" value={selected.every(object => object.kind === 'stroke' && object.preset === (selected[0] as Extract<BoardObject, { kind: 'stroke' }>).preset) ? (selected[0] as Extract<BoardObject, { kind: 'stroke' }>).preset : ''} onChange={event => preset(event.target.value as 'pen' | 'marker')}><option value="" disabled>Mixed</option><option value="pen">Pen</option><option value="marker">Marker</option></select></label>}
    {supports('size') && select('size', 'Text size', ['S', 'M', 'L', 'XL'])}
    {supports('bold') && toggle('bold', 'Bold')}{supports('italic') && toggle('italic', 'Italic')}
    {supports('align') && select('align', 'Alignment', ['left', 'center', 'right'])}
    {supports('tone') && <div role="group" aria-label="Sticky tone" className="wb-root__swatch-tray">
      {STICKY_TONES.map(tone => <button type="button" key={tone} className="wb-root__swatch" aria-label={`${tone} tone`} aria-pressed={currentTone === tone} style={{ background: `var(--wb-sticky-${tone})` }} onClick={() => {
        style('tone', tone); session.setStyleDefaults({ sticky: { font: 'handwriting', tone } });
      }} />)}
      <label className="wb-root__swatch wb-ui-colour-picker" title="Custom sticky colour" data-active={String(isHexColour(currentTone))} style={{ background: isHexColour(currentTone) ? currentTone : undefined }}>
        <input type="color" aria-label="Custom sticky colour" value={pickerHexForStickyTone(currentTone || 'yellow')} onChange={event => {
          const hex = normalizeHexColour(event.target.value);
          if (!hex) return;
          styleDebounced('tone', hex); session.setStyleDefaults({ sticky: { font: 'handwriting', tone: hex } });
        }} />
      </label>
    </div>}
    {selected.every(object => object.kind === 'sticky') && <div ref={reactAnchorRef} className="wb-ui-reactions-anchor">
      <button type="button" className="wb-ui-reaction-trigger" aria-label="Add reaction" title="Add reaction" aria-expanded={reactOpen} aria-pressed={reactOpen} onClick={() => setReactOpenFor(open => open === selectionKey ? null : selectionKey)}>😊+</button>
      {reactOpen && <div role="group" aria-label="Sticky reactions" className="wb-ui-reactions-popover">
        {STICKY_REACTION_PRESETS.map(emoji => <button type="button" key={emoji} className="wb-ui-reaction-btn" aria-label={`React ${emoji}`} title={`React ${emoji}`} onClick={() => { react(emoji); setReactOpenFor(null); }}>{emoji}</button>)}
      </div>}
    </div>}
    <button type="button" aria-label="Bring to front" title="Bring to front · ]" onClick={() => reorder(true)}><BoardIcon name="front" /></button>
    <button type="button" aria-label="Send to back" title="Send to back · [" onClick={() => reorder(false)}><BoardIcon name="back" /></button>
    <button type="button" aria-label="Delete selection" title="Delete" onClick={() => { if (dispatch(selected.map(object => ({ id: object.id, action: 'delete', expectedVersion: object.version })), 'Delete selection')) session.setSelectedIds([]); }}><BoardIcon name="delete" /></button>
  </div>;
}
