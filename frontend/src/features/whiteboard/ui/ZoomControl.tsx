import { useEffect, useRef } from 'react';
import { MAX_ZOOM, MIN_ZOOM } from '../contract';
import { fitToBounds, getBounds, unionBounds, zoomAt } from '../core';
import { BoardIcon } from './icons';
import type { BoardUIProps } from './Toolbar';

export function ZoomControl({ store, runtime }: BoardUIProps) {
  const root = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLButtonElement>(null);
  const minus = useRef<HTMLButtonElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let frame = 0;
    function draw() {
      frame = 0;
      const { zoom } = runtime.getCamera();
      if (readout.current) readout.current.textContent = `${Math.round(zoom * 100)}%`;
      if (minus.current) minus.current.disabled = zoom <= MIN_ZOOM;
      if (plus.current) plus.current.disabled = zoom >= MAX_ZOOM;
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(draw); }
    draw();
    const unsubscribe = runtime.subscribeCamera(schedule);
    return () => { unsubscribe(); cancelAnimationFrame(frame); };
  }, [runtime]);
  function viewport() {
    return root.current?.closest<HTMLElement>('[data-wb-viewport]');
  }
  function zoom(factor: number) {
    const element = viewport();
    if (!element) return;
    runtime.setCamera(zoomAt(runtime.getCamera(), { x: element.clientWidth / 2, y: element.clientHeight / 2 }, runtime.getCamera().zoom * factor));
  }
  function fit() {
    const element = viewport();
    const objects = store.getObjectsInRank();
    if (!element) return;
    runtime.setCamera(objects.length ? fitToBounds(unionBounds(objects.map(getBounds)), { x: 0, y: 0, w: element.clientWidth, h: element.clientHeight }, 64) : { x: 0, y: 0, zoom: 1 });
  }
  return <div data-wb-ui ref={root} className="wb-root__zoom" role="group" aria-label="Board zoom">
    <button type="button" ref={minus} className="wb-root__zoom-button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1 / 1.2)}><BoardIcon name="minus" /></button>
    <button type="button" ref={readout} className="wb-root__readout wb-ui-fit" aria-label="Zoom to fit all (Shift+1)" title="Zoom to fit all · Shift+1" onClick={fit}>100%</button>
    <button type="button" ref={plus} className="wb-root__zoom-button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.2)}><BoardIcon name="plus" /></button>
  </div>;
}
