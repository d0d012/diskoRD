import { useLayoutEffect, useRef } from 'react';
import type { Runtime } from '../../contract';
import { setSnapGuides, snapState } from './snapState';

interface SnapGuidesProps { runtime: Runtime }
/** Transient geometry stays outside React and is painted once per animation frame. */
export function SnapGuides({ runtime }: SnapGuidesProps) {
  const root = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const svg = root.current!;
    const viewport = svg.closest<HTMLElement>('[data-wb-viewport]')!;
    const state = snapState(runtime);
    let frame = 0;
    function measure() { state.viewport = { x: 0, y: 0, w: viewport.clientWidth, h: viewport.clientHeight }; }
    function paint() {
      frame = 0;
      svg.replaceChildren();
      const camera = runtime.getCamera();
      for (const guide of state.guides) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        const fixed = guide.value * camera.zoom + (guide.axis === 'x' ? camera.x : camera.y);
        const offset = guide.axis === 'x' ? camera.y : camera.x;
        const from = guide.from * camera.zoom + offset; const to = guide.to * camera.zoom + offset;
        line.setAttribute('x1', String(guide.axis === 'x' ? fixed : from));
        line.setAttribute('x2', String(guide.axis === 'x' ? fixed : to));
        line.setAttribute('y1', String(guide.axis === 'y' ? fixed : from));
        line.setAttribute('y2', String(guide.axis === 'y' ? fixed : to));
        svg.append(line);
      }
    }
    function schedule() { if (!frame && (state.guides.length || svg.childElementCount)) frame = requestAnimationFrame(paint); }
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(viewport);
    state.listeners.add(schedule);
    const offCamera = runtime.subscribeCamera(schedule);
    const offPreview = runtime.subscribePreview(preview => {
      if (!preview.objects.length) setSnapGuides(runtime, []);
    });
    return () => { observer?.disconnect(); offCamera(); offPreview(); state.listeners.delete(schedule); cancelAnimationFrame(frame); state.guides = []; };
  }, [runtime]);
  return <svg ref={root} data-wb-snap-guides="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', stroke: 'var(--wb-selection-color)', strokeWidth: 1 }} />;
}
