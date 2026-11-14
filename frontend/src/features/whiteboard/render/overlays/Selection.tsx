import { useLayoutEffect, useRef } from 'react';
import type { BoardObject, Camera } from '../../contract';
import { paintSelection } from './paint';

interface SelectionProps { objects?: readonly BoardObject[]; camera?: Camera }
const EMPTY: readonly BoardObject[] = [];
const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Screen-space selection layer; the scene repaints it from rAF on every change. */
export function Selection({ objects = EMPTY, camera = DEFAULT_CAMERA }: SelectionProps) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (root.current) paintSelection(root.current, objects, camera);
  }, [objects, camera]);
  return <div ref={root} className="wb-render-selection-layer" data-wb-selection-layer="" aria-hidden="true" />;
}
