import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useStore } from 'zustand';
import { STICKY_TONES, STROKE_WEIGHTS, STROKE_WEIGHT_WORLD_UNITS } from '../contract';
import type { BoardStore, Runtime, StrokeWeight, ToolId } from '../contract';
import { isHexColour, normalizeHexColour, pickerHexForColour, pickerHexForStickyTone, resolveInkCss } from '../core';
import type { SessionStore } from '../state';
import { BoardIcon } from './icons';

export interface BoardUIProps {
  store: BoardStore;
  session: SessionStore;
  runtime: Runtime;
}

const tools = [
  ['select', 'Select', 'V'], ['hand', 'Hand', 'H'], ['pen', 'Pen', 'P'], ['laser', 'Laser', 'K'],
  ['sticky', 'Sticky', 'S'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'],
  ['line', 'Line', 'L'], ['arrow', 'Arrow', 'A'], ['text', 'Text', 'T'], ['image', 'Image', 'I'], ['frame', 'Frame', 'F'],
] as const;

/** Same stroke style as BoardIcon; kept here because icons.tsx is not part of the image work. */
function ImageIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16v16H4ZM4 16l5-5 4 4 3-3 4 4M9 8.5h.01" /></svg>;
}

/** A click this soon after the picker closed is the click that dismissed it. */
const DISMISS_CLICK_MS = 250;

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
}

const WEIGHT_LABELS: Record<StrokeWeight, string> = { thin: 'Thin', thick: 'Medium', bold: 'Bold', heavy: 'Heavy' };

interface PenMenuProps {
  session: SessionStore;
  onClose: () => void;
}

/** Right-click menu of the Pen button: line thickness and the pen/eraser switch. */
function PenMenu({ session, onClose }: PenMenuProps) {
  const tool = useStore(session, state => state.tool);
  const defaults = useStore(session, state => state.styleDefaults);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    event.stopPropagation();
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
  return (
    <div ref={ref} data-wb-ui className="wb-pen-menu" role="menu" aria-label="Pen options" onKeyDown={onKeyDown}>
      <div className="wb-pen-menu__title">Thickness</div>
      {STROKE_WEIGHTS.map(weight => (
        <button type="button" key={weight} role="menuitemradio" className="wb-pen-menu__item"
          aria-checked={defaults.stroke.weight === weight}
          onClick={() => {
            session.setStyleDefaults({ stroke: { ...defaults.stroke, weight } });
            if (session.getState().tool !== 'pen') session.setTool('pen');
            onClose();
          }}>
          <span className="wb-pen-menu__line" style={{ height: STROKE_WEIGHT_WORLD_UNITS[weight], background: resolveInkCss(defaults.stroke.colour) }} />
          <span>{WEIGHT_LABELS[weight]}</span>
        </button>
      ))}
      <div className="wb-pen-menu__separator" role="separator" />
      <button type="button" role="menuitemcheckbox" className="wb-pen-menu__item" aria-checked={tool === 'eraser'}
        onClick={() => { session.setEditingId(null); session.setTool(tool === 'eraser' ? 'pen' : 'eraser'); onClose(); }}>
        <BoardIcon name={tool === 'eraser' ? 'pen' : 'eraser'} />
        <span>{tool === 'eraser' ? 'Switch to pen' : 'Switch to eraser'}</span>
        <kbd>{tool === 'eraser' ? 'P' : 'E'}</kbd>
      </button>
    </div>
  );
}

export function Toolbar({ session }: BoardUIProps) {
  const [penMenuOpen, setPenMenuOpen] = useState(false);
  const tool = useStore(session, state => state.tool);
  const defaults = useStore(session, state => state.styleDefaults);
  // Roving tabindex: exactly one dock button is a tab stop (the focused one, else the active tool).
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const stop = focusKey ?? tool;
  // The picker closes itself on the pointer-down that precedes this button's click; that click
  // must not reopen it. Remember, briefly, that the Image tool just ended.
  const justDismissed = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = session.subscribe((state, previous) => {
      if (previous.tool !== 'image' || state.tool === 'image') return;
      justDismissed.current = true;
      clearTimeout(timer);
      timer = setTimeout(() => { justDismissed.current = false; }, DISMISS_CLICK_MS);
    });
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [session]);
  function selectTool(next: ToolId) {
    session.setEditingId(null);
    if (next === 'image') {
      // The Image tool is not a drawing mode: it means "the picker is open" and ends with it.
      if (session.getState().tool !== 'image' && !justDismissed.current) session.setTool('image');
      else session.setTool('select');
      return;
    }
    session.setTool(next);
  }
  return (
    <div data-wb-ui className="wb-root__dock" role="toolbar" aria-label="Board tools" onKeyDown={moveFocus} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusKey(null); }}>
      {tools.map(([id, label, shortcut]) => (
        <div className="wb-ui-tool-group" key={id}>
          <button type="button" className="wb-root__tool-button" aria-label={`${label} (${shortcut})`} aria-keyshortcuts={shortcut}
            aria-pressed={tool === id || (id === 'pen' && tool === 'eraser')} tabIndex={stop === id || (id === 'pen' && stop === 'eraser') ? 0 : -1} onFocus={() => setFocusKey(id)}
            aria-haspopup={id === 'pen' ? 'menu' : undefined} aria-expanded={id === 'pen' ? penMenuOpen : undefined}
            data-wb-tooltip={penMenuOpen && id === 'pen' ? undefined : id === 'pen' ? (tool === 'eraser' ? 'Eraser · E · right-click for options' : `${label} · ${shortcut} · right-click for options`) : `${label} · ${shortcut}`}
            onClick={() => selectTool(id)}
            onContextMenu={id === 'pen' ? event => { event.preventDefault(); setPenMenuOpen(open => !open); } : undefined}>
            {id === 'image' ? <ImageIcon /> : <BoardIcon name={id === 'pen' && tool === 'eraser' ? 'eraser' : id} />}
            {id === 'pen' && <span className="wb-root__tool-ink-dot" style={{ '--wb-current-ink': resolveInkCss(defaults.stroke.colour) } as CSSProperties} />}
          </button>
          {id === 'pen' && penMenuOpen && <PenMenu session={session} onClose={() => setPenMenuOpen(false)} />}
          {id === 'pen' && <label className="wb-root__swatch wb-ui-colour-picker" data-wb-tooltip="Custom ink colour" style={{ background: resolveInkCss(defaults.stroke.colour) }}>
            <input type="color" tabIndex={-1} aria-label="Dock custom ink colour" value={pickerHexForColour(defaults.stroke.colour)} onChange={event => {
              const hex = normalizeHexColour(event.target.value);
              if (!hex) return;
              session.setStyleDefaults({
                stroke: { ...defaults.stroke, colour: hex },
                shape: { ...defaults.shape, colour: hex },
                text: { ...defaults.text, colour: hex },
                frame: { ...defaults.frame, colour: hex },
              });
            }} />
          </label>}
          {id === 'sticky' && <div className="wb-root__swatch-tray" role="group" aria-label="Sticky colours">
            {STICKY_TONES.map(tone => <button type="button" key={tone} className="wb-root__swatch" tabIndex={stop === `swatch-${tone}` ? 0 : -1}
              onFocus={() => setFocusKey(`swatch-${tone}`)}
              aria-label={`${tone} sticky (S)`} aria-pressed={tool === 'sticky' && defaults.sticky.tone === tone}
              data-wb-tooltip={`${tone} sticky · S`} style={{ background: `var(--wb-sticky-${tone})` }}
              onClick={() => { session.setStyleDefaults({ sticky: { ...defaults.sticky, tone } }); selectTool('sticky'); }} />)}
            <label className="wb-root__swatch wb-ui-colour-picker" data-active={String(tool === 'sticky' && isHexColour(defaults.sticky.tone))} data-wb-tooltip="Custom sticky colour" style={{ background: isHexColour(defaults.sticky.tone) ? defaults.sticky.tone : undefined }}>
              <input type="color" tabIndex={-1} aria-label="Dock custom sticky colour" value={pickerHexForStickyTone(defaults.sticky.tone)} onChange={event => {
                const hex = normalizeHexColour(event.target.value);
                if (!hex) return;
                session.setStyleDefaults({ sticky: { ...defaults.sticky, tone: hex } });
                if (session.getState().tool !== 'sticky') selectTool('sticky');
              }} />
            </label>
          </div>}
        </div>
      ))}
    </div>
  );
}
