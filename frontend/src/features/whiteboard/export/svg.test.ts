import { describe, expect, it } from 'vitest';
import type { BoardObject } from '../contract';
import { frame, image, rect, sticky, stroke } from '../render/testObjects';
import { exportRegion } from './region';
import { planExport } from './scale';
import { buildBoardSvg } from './svg';
import { assetDisplayUrl } from '../assets/displayUrl';

function svgFor(objects: readonly BoardObject[], selectedIds: string[] = []) {
  const region = exportRegion({ objects, selectedIds, channelName: 'design' });
  expect(region).not.toBeNull();
  const plan = planExport(region!.bounds);
  return buildBoardSvg(region!, plan, { measureAt: () => run => run.length });
}

describe('buildBoardSvg', () => {
  it('emits the perfect-freehand stroke path with its resolved ink colour', () => {
    const svg = svgFor([stroke]);
    expect(svg).toContain('d="M');
    expect(svg).toContain('fill="#a855f7"');
  });

  it('emits shapes with the same stroke/fill geometry as the renderer', () => {
    const svg = svgFor([rect]);
    expect(svg).toContain('rx="8"');
    expect(svg).toContain('stroke="#38bdf8"');
    expect(svg).toContain('fill-opacity="0.15"');
  });

  it('emits cropped images pointing at the display URL', () => {
    const svg = svgFor([image]);
    // Resolved against VITE_API_URL when one is configured (e.g. a local .env).
    expect(svg).toContain(`href="${assetDisplayUrl('/uploads/a.png')}"`);
    expect(svg).toContain('viewBox="100 0 200 100"');
    expect(svg).toContain('crossorigin="anonymous"');
  });

  it('emits wrapped text with the handwriting font for stickies', () => {
    const svg = svgFor([sticky]);
    expect(svg).toContain('font-family="&quot;Caveat&quot;, cursive"');
    expect(svg).toContain('Plan the boss fight');
  });

  it('clips a frame export and includes the frame border and label', () => {
    const region = exportRegion({ objects: [frame, rect], selectedIds: [frame.id], channelName: 'design' });
    expect(region).not.toBeNull();
    const plan = planExport(region!.bounds);
    const svg = buildBoardSvg(region!, plan, { measureAt: () => run => run.length });
    expect(svg).toContain('<clipPath id="wb-export-clip">');
    expect(svg).toContain('clip-path="url(#wb-export-clip)"');
    expect(svg).toContain('rgba(88, 101, 242, 0.35)');
    expect(svg).toContain('Sprint');
  });

  it('emits the frame border and chip label for a whole-board export', () => {
    const svg = svgFor([frame]);
    expect(svg).toContain('stroke="rgba(88, 101, 242, 0.35)"');
    expect(svg).toContain('rx="10"');
    expect(svg).toContain('Sprint');
  });

  it('includes the board background', () => {
    const svg = svgFor([rect]);
    expect(svg).toContain('fill="#15171e"');
  });
});
