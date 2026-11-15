import { describe, expect, it } from 'vitest';
import type { BoardObject } from '../contract';
import { rankPrefix } from '../core';
import { createHarness, USER } from '../input/testUtils';
import { TEMPLATES, templateById } from './templates';
import { applyTemplate } from './applyTemplate';

function centre(objects: readonly BoardObject[]): { x: number; y: number } {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const object of objects) {
    minX = Math.min(minX, object.x); minY = Math.min(minY, object.y);
    maxX = Math.max(maxX, object.x + object.w); maxY = Math.max(maxY, object.y + object.h);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

describe('applyTemplate', () => {
  it('applies the sprint board as one command, centred on the viewport', () => {
    const h = createHarness();
    const ids = applyTemplate('sprint', {
      store: h.store, session: h.session, runtime: h.runtime, userId: USER,
      newId: h.ctx.newId, getViewportSize: () => ({ width: 1000, height: 800 }),
    });

    expect(ids).toHaveLength(9);
    const pending = h.store.getPendingOperations();
    expect(pending).toHaveLength(1);
    expect(pending[0].command.changes).toHaveLength(9);

    const objects = h.store.getObjectsInRank();
    expect(objects.filter(object => object.kind === 'frame')).toHaveLength(3);
    expect(objects.filter(object => object.kind === 'sticky')).toHaveLength(6);
    // Frames keep the frame partition, stickies the object partition.
    expect(objects.filter(object => object.kind === 'frame').every(object => rankPrefix(object.rank) === '0')).toBe(true);
    expect(objects.filter(object => object.kind === 'sticky').every(object => rankPrefix(object.rank) === '1')).toBe(true);
    expect(centre(objects)).toEqual({ x: 500, y: 400 });

    // One undo step reverts the whole template.
    h.ackAll();
    h.store.undo();
    expect(h.store.getObjectIds()).toHaveLength(0);
  });

  it.each([
    ['retro', 3, 6, ['Went well', 'To improve', 'Actions']],
    ['moodboard', 6, 0, ['Mood', 'Palette', 'Type', 'Light', 'Texture', 'Vibe']],
    ['sprite-critique', 6, 0, ['Idle', 'Walk', 'Attack', 'Jump', 'Hurt', 'Death']],
  ] as const)('%s builds the expected frames and stickies', (id, frames, stickies, labels) => {
    const h = createHarness();
    const ids = applyTemplate(id, {
      store: h.store, session: h.session, runtime: h.runtime, userId: USER,
      newId: h.ctx.newId, getViewportSize: () => ({ width: 1000, height: 800 }),
    });

    expect(ids).toHaveLength(frames + stickies);
    const objects = h.store.getObjectsInRank();
    const frameObjects = objects.filter(object => object.kind === 'frame');
    expect(frameObjects).toHaveLength(frames);
    expect(objects.filter(object => object.kind === 'sticky')).toHaveLength(stickies);
    expect(frameObjects.map(object => object.kind === 'frame' ? object.label : '')).toEqual(labels);
  });

  it('returns null for an unknown template and touches nothing', () => {
    const h = createHarness();
    expect(applyTemplate('nope', {
      store: h.store, session: h.session, runtime: h.runtime, userId: USER,
      newId: h.ctx.newId, getViewportSize: () => ({ width: 1000, height: 800 }),
    })).toBeNull();
    expect(h.store.getObjectIds()).toHaveLength(0);
    expect(h.store.getPendingOperations()).toHaveLength(0);
  });

  it('ships exactly the four starter templates', () => {
    expect(TEMPLATES.map(template => template.id)).toEqual(['sprint', 'retro', 'moodboard', 'sprite-critique']);
    expect(templateById('sprint')?.name).toBe('Sprint board');
  });
});
