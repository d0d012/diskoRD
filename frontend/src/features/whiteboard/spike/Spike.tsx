import { memo, useEffect, useRef, useState } from 'react';
import { startRuntime } from './runtime';
import type { SpikeResult } from './runtime';
import type { Camera, Options, SceneObject, SpatialGrid } from './scene';

interface ObjectProps {
  object: SceneObject;
  nodes: Map<number, HTMLDivElement>;
}

function SceneItem({ object, nodes }: ObjectProps) {
  const { id, kind, x, y, width, height, color } = object;
  return (
    <div
      ref={(node) => {
        if (node) nodes.set(id, node);
        else nodes.delete(id);
      }}
      className={`spike-object spike-${kind}`}
      data-object-id={id}
      style={{
        transform: `translate(${x}px, ${y}px)`, width, height,
        ...(kind === 'sticky' ? { backgroundColor: color } : {}),
      }}
    >
      {kind === 'sticky' && <div>{object.text}</div>}
      {kind === 'text' && <div style={{ color }}>{object.text}<br />Idea #{id}</div>}
      {kind === 'frame' && <span>Frame #{id} — planning</span>}
      {kind === 'shape' && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {object.ellipse
            ? <ellipse cx={width / 2} cy={height / 2} rx={width / 2 - 3} ry={height / 2 - 3} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={3} />
            : <rect x={3} y={3} width={width - 6} height={height - 6} rx={8} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={3} />}
        </svg>
      )}
      {kind === 'stroke' && <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}><path d={object.path} fill={color} /></svg>}
      {kind === 'image' && <img src={object.src} alt={`Generated bitmap ${id}`} draggable={false} width={width} height={height} style={{ imageRendering: object.pixelated ? 'pixelated' : 'auto' }} />}
    </div>
  );
}

const MemoSceneItem = memo(SceneItem);

interface SpikeProps {
  objects: SceneObject[];
  grid: SpatialGrid;
  options: Options;
  initialCamera: Camera;
  initialVisible: SceneObject[];
  startedAt: number;
  sceneBuildMs: number;
}

export function Spike({ objects, grid, options, initialCamera, initialVisible, startedAt, sceneBuildMs }: SpikeProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const camera = useRef({ ...initialCamera });
  const [nodes] = useState(() => new Map<number, HTMLDivElement>());
  const runtime = useRef<ReturnType<typeof startRuntime> | null>(null);
  const [visible, setVisible] = useState(initialVisible);
  const [status, setStatus] = useState({ text: 'Mounting…', running: false, ready: false });
  const [result, setResult] = useState<SpikeResult | null>(null);

  useEffect(() => {
    if (!viewport.current || !world.current) return;
    const active = startRuntime({
      objects, grid, options, initialVisible, startedAt, sceneBuildMs,
      viewport: viewport.current, world: world.current, camera, nodes,
      onVisible: setVisible,
      onStatus: (text, running, ready) => setStatus({ text, running, ready }),
      onResult: setResult,
    });
    runtime.current = active;
    return () => { active.dispose(); runtime.current = null; };
  }, [objects, grid, options, initialVisible, startedAt, sceneBuildMs, nodes]);

  return (
    <>
      <div className="spike-viewport" ref={viewport} aria-label="Board rendering benchmark viewport">
        <div className="spike-world" ref={world} style={{ transform: `translate(${initialCamera.x}px, ${initialCamera.y}px) scale(${initialCamera.zoom})` }}>
          {visible.map((object) => <MemoSceneItem key={object.id} object={object} nodes={nodes} />)}
        </div>
      </div>
      <section className="spike-panel">
        <h1>Board M0 · throwaway DOM/SVG benchmark</h1>
        <p>{options.n.toLocaleString()} objects · cull={Number(options.cull)} · willchange={Number(options.willchange)}</p>
        <p>Wheel/drag to pan · Ctrl/⌘ + wheel to zoom. Run in a foreground tab at a fixed window size.</p>
        <p>5s pan → 5s zoom (25–200%) → 5s group drag. No StrictMode. Development Vite/React overhead is included.</p>
        <button disabled={!status.ready || status.running} onClick={() => runtime.current?.start()}>Run 15s benchmark</button>
        <button disabled={status.running} onClick={() => runtime.current?.reset()}>Recenter</button>
        <p role="status">{status.text}</p>
        <details open={result !== null}>
          <summary>Results (also window.__wbSpikeResult)</summary>
          <pre id="wb-spike-result">{result ? JSON.stringify(result, null, 2) : '{}'}</pre>
        </details>
      </section>
    </>
  );
}
