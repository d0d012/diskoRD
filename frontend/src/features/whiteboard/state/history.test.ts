import { describe, expect, it } from 'vitest';
import type { RectObject } from '../contract';
import { BoardHistory, prepareHistoryChanges } from './history';

const object: RectObject = {
  id: 'a', kind: 'rect', createdBy: 'me', version: 5, rank: '1:a', x: 0, y: 0, w: 10, h: 10,
  style: { colour: 'ink', weight: 'thin', fill: 'none' },
};

describe('history bookkeeping', () => {
  it('protects objects with unacknowledged local changes even when versions still match', () => {
    const result = prepareHistoryChanges({
      opId: 'op', acknowledgedSeq: 5,
      inverse: [{ id: 'a', action: 'delete', expectedVersion: 0 }],
    }, new Map([['a', object]]), new Map(), new Set(['a']));
    expect(result.changes).toEqual([]);
    expect(result.skipped).toEqual([{ id: 'a', reason: 'pending' }]);
  });

  it('retains an unacknowledged request until acknowledgement', () => {
    const history = new BoardHistory();
    history.record({ opId: 'op', inverse: [{ id: 'a', action: 'delete', expectedVersion: 0 }] });
    expect(history.begin('undo', 'undo')?.opId).toBe('undo');
    expect(history.ready()).toBeNull();
    expect(history.begin('undo', 'duplicate')).toBeNull();
    history.acknowledge('op', 5);
    expect(history.ready()?.entry.acknowledgedSeq).toBe(5);
  });

  it('requires a positive bounded stack capacity', () => {
    expect(() => new BoardHistory(0)).toThrow();
    expect(() => new BoardHistory(1.5)).toThrow();
  });
});
