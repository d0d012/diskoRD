import { describe, expect, it, vi } from 'vitest';
import type { BoardObject } from '../contract';
import { MAX_CHANGES_PER_COMMAND, MAX_COMMAND_BYTES } from '../contract';
import { rankPrefix } from '../core';
import { commandBytes } from '../input/objects';
import { createHarness, USER } from '../input/testUtils';
import { validateObject } from '../sync/validation';
import { TEMPLATES, templateById } from './templates';
import { applyTemplate } from './applyTemplate';

function centre(objects: readonly BoardObject[]): { x: number; y: number } {
  const minX = Math.min(...objects.map(o => o.x)); const minY = Math.min(...objects.map(o => o.y));
  const maxX = Math.max(...objects.map(o => o.x + o.w)); const maxY = Math.max(...objects.map(o => o.y + o.h));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

describe('applyTemplate', () => {
  it.each(TEMPLATES)('$name is valid, rich, within budgets and one undo step', template => {
    const h = createHarness();
    const ids = applyTemplate(template.id, {
      store: h.store, session: h.session, runtime: h.runtime, userId: USER,
      newId: h.ctx.newId, getViewportSize: () => ({ width: 1000, height: 800 }),
    });
    expect(ids).toHaveLength(template.items.length);
    const pending = h.store.getPendingOperations();
    expect(pending).toHaveLength(1);
    const command = pending[0].command;
    expect(command.changes.length).toBeLessThanOrEqual(MAX_CHANGES_PER_COMMAND);
    expect(commandBytes(command.changes)).toBeLessThan(MAX_COMMAND_BYTES);
    // Include the envelope too, conservatively.
    expect(new TextEncoder().encode(JSON.stringify(command)).byteLength).toBeLessThan(MAX_COMMAND_BYTES);
    const objects = h.store.getObjectsInRank();
    for (const object of objects) {
      expect(() => validateObject(object)).not.toThrow();
      expect(rankPrefix(object.rank)).toBe(object.kind === 'frame' ? '0' : '1');
    }
    const frames = objects.filter(o => o.kind === 'frame');
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const a = frames[i]; const b = frames[j];
        expect(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y).toBe(false);
      }
    }
    expect(objects.filter(o => o.kind !== 'frame').length).toBeGreaterThanOrEqual(8);
    expect(centre(objects)).toEqual({ x: 500, y: 400 });
    h.ackAll(); h.store.undo();
    expect(h.store.getObjectIds()).toHaveLength(0);
  });

  it('places a second template at the current viewport centre and preserves existing content', () => {
    const h = createHarness();
    const options = { store: h.store, session: h.session, runtime: h.runtime, userId: USER,
      newId: h.ctx.newId, getViewportSize: () => ({ width: 1000, height: 800 }) };
    const first = applyTemplate('sprint', options)!;
    h.ackAll();
    h.runtime.setCamera({ x: -4000, y: -2000, zoom: 1 });
    const ids = applyTemplate('moodboard', options)!;
    expect(centre(ids.map(id => h.store.getObject(id)!))).toEqual({ x: 4500, y: 2400 });
    expect(first.every(id => h.store.getObject(id))).toBe(true);
    expect(h.store.getPendingOperations()).toHaveLength(1);
  });

  it('reports distant placement refusal without moving the camera or inserting anything', () => {
    const h = createHarness(); const notify = vi.fn();
    const options = { store: h.store, session: h.session, runtime: h.runtime, userId: USER,
      newId: h.ctx.newId, notify, getViewportSize: () => ({ width: 1000, height: 800 }) };
    applyTemplate('sprint', options); h.ackAll();
    const count = h.store.getObjectIds().length;
    h.runtime.setCamera({ x: -100000, y: 0, zoom: 1 });
    const camera = h.runtime.getCamera();
    expect(applyTemplate('kanban', options)).toBeNull();
    expect(h.store.getObjectIds()).toHaveLength(count);
    expect(h.runtime.getCamera()).toEqual(camera);
    expect(notify).toHaveBeenCalledWith('refused', 'Too far from existing content.');
  });

  it('returns null for an unknown template', () => {
    const h = createHarness();
    expect(applyTemplate('nope', { ...h.ctx })).toBeNull();
    expect(h.store.getObjectIds()).toHaveLength(0);
  });

  it('ships fourteen distinct templates covering every requested object kind and tone', () => {
    expect(TEMPLATES).toHaveLength(14);
    expect(new Set(TEMPLATES.map(t => t.id)).size).toBe(TEMPLATES.length);
    const items = TEMPLATES.flatMap(t => t.items);
    expect(new Set(items.map(i => i.kind))).toEqual(new Set(['frame', 'sticky', 'text', 'rect', 'ellipse', 'line', 'arrow']));
    expect(new Set(items.filter(i => i.kind === 'sticky').map(i => i.tone))).toEqual(new Set(['mint', 'yellow', 'pink', 'sky']));
    expect(templateById('sprint')?.name).toBe('Sprint board');
  });
});
