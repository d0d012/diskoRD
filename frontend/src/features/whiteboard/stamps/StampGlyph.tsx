import { memo } from 'react';
import { STAMP_SIZE, stampCells } from './stamps';
import type { StampDef } from './stamps';

interface StampGlyphProps {
  readonly stamp: StampDef;
  readonly size?: number;
  readonly className?: string;
}

/** Tiny crisp inline-SVG pixel grid of a stamp. */
export const StampGlyph = memo(function StampGlyph({ stamp, size = 32, className }: StampGlyphProps) {
  const cells = stampCells(stamp);
  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${STAMP_SIZE} ${STAMP_SIZE}`}
      shapeRendering="crispEdges" aria-hidden="true">
      {cells.map((cell, index) => <rect key={index} x={cell.x} y={cell.y} width={1} height={1} fill={cell.colour} />)}
    </svg>
  );
});
