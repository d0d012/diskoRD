// This folder is a throwaway benchmark to be deleted after M0.
import { createRoot } from 'react-dom/client';
import { Spike } from './Spike';
import { centeredCamera, createScene, readOptions, SpatialGrid, viewportBounds } from './scene';
import './spike.css';

const startedAt = performance.now();
const options = readOptions(window.location.search);
const objects = createScene(options.n);
const grid = new SpatialGrid(objects);
const initialCamera = centeredCamera(window.innerWidth, window.innerHeight);
const initialVisible = options.cull
  ? grid.query(viewportBounds(initialCamera, window.innerWidth, window.innerHeight))
  : objects;
const sceneBuildMs = performance.now() - startedAt;

createRoot(document.getElementById('root')!).render(
  <Spike
    objects={objects}
    grid={grid}
    options={options}
    initialCamera={initialCamera}
    initialVisible={initialVisible}
    startedAt={startedAt}
    sceneBuildMs={sceneBuildMs}
  />,
);
