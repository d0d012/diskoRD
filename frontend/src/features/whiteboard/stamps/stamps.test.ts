import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAMP_PNG_SIZE, STAMP_SIZE, STAMPS, rasterizeStamp, stampCells, stampColourAt } from './stamps';

afterEach(() => { vi.restoreAllMocks(); });

describe('stamp definitions', () => {
  it('ships the 16 required stickers', () => {
    expect(STAMPS.map(stamp => stamp.id)).toEqual([
      'thumbs-up', 'star', 'heart', 'check', 'cross', 'question', 'fire', 'crown',
      'skull', 'arrow', 'flag', 'eyes', 'hundred', 'party', 'coffee', 'bug',
    ]);
  });

  it('every stamp is a valid STAMP_SIZE square using only known palette keys', () => {
    for (const stamp of STAMPS) {
      expect(stamp.rows).toHaveLength(STAMP_SIZE);
      stamp.rows.forEach(row => expect(row).toHaveLength(STAMP_SIZE));
      const cells = stampCells(stamp);
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) expect(cell.colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('stampColourAt agrees with stampCells and reports transparent cells', () => {
    const stamp = STAMPS[0];
    for (const cell of stampCells(stamp)) expect(stampColourAt(stamp, cell.x, cell.y)).toBe(cell.colour);
    let foundTransparent = false;
    for (let y = 0; y < STAMP_SIZE && !foundTransparent; y++) {
      for (let x = 0; x < STAMP_SIZE; x++) {
        if (stampColourAt(stamp, x, y) === null) { foundTransparent = true; break; }
      }
    }
    expect(foundTransparent).toBe(true);
  });
});

describe('rasterizeStamp', () => {
  it('renders a nearest-neighbour PNG of STAMP_PNG_SIZE', async () => {
    const fillRect = vi.fn();
    const context = { fillRect, fillStyle: '', imageSmoothingEnabled: true } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(new Blob(['png'], { type: 'image/png' }));
    });

    const stamp = STAMPS[0];
    const blob = await rasterizeStamp(stamp);

    expect(blob.type).toBe('image/png');
    expect(fillRect).toHaveBeenCalledTimes(stampCells(stamp).length);
    expect(fillRect).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), STAMP_PNG_SIZE / STAMP_SIZE, STAMP_PNG_SIZE / STAMP_SIZE);
  });
});
