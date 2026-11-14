import type { BoardObject } from '../../contract';
import { paintObject } from '../objects/presentation';

/** A detached, noninteractive render shell, including objects culled locally.
 * Geometry/text/path/style come from the SAME painter as normal objects. No
 * React root, mounted object mutation, HTML injection or preview-store writes.
 */
export function createGhostObject(doc: Document, object: BoardObject): HTMLDivElement {
  function div(className: string, parent: HTMLElement): HTMLDivElement {
    const node = doc.createElement('div');
    node.className = className;
    parent.appendChild(node);
    return node;
  }
  const node = doc.createElement('div');
  node.className = `wb-render-object wb-render-${object.kind} wb-presence-ghost`;
  node.dataset.wbRemoteGhost = object.id;
  const visual = div('wb-render-visual', node);
  switch (object.kind) {
    case 'text':
      div('wb-render-text', visual).dataset.wbText = '';
      break;
    case 'sticky': {
      div('wb-render-sticky-text', div('wb-root__sticky wb-render-sticky-note', visual)).dataset.wbText = '';
      div('wb-render-sticky-reactions', visual).dataset.wbStickyReactions = '';
      break;
    }
    case 'image': {
      const image = doc.createElement('img');
      image.alt = '';
      image.draggable = false;
      div('wb-render-image-crop', visual).appendChild(image);
      break;
    }
    case 'frame': {
      div('wb-root__frame wb-render-frame-border', visual);
      const label = div('wb-root__frame-label wb-render-frame-label', visual);
      label.dataset.wbFrameLabel = object.id;
      const chip = doc.createElement('span');
      chip.className = 'wb-root__frame-chip';
      chip.textContent = 'F';
      const title = doc.createElement('span');
      title.dataset.wbFrameTitle = '';
      label.append(chip, title);
      break;
    }
    default: {
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const tags = object.kind === 'arrow' ? ['line', 'path'] :
        object.kind === 'stroke' ? ['path'] : [object.kind];
      for (const tag of tags) {
        const shape = doc.createElementNS('http://www.w3.org/2000/svg', tag);
        if (object.kind === 'rect' || object.kind === 'ellipse') shape.setAttribute('data-wb-shape', '');
        svg.appendChild(shape);
      }
      visual.appendChild(svg);
    }
  }
  paintObject(node, object, false, true);
  // This marker belongs to input hit targets, not to noninteractive ghosts.
  node.querySelector('[data-wb-frame-label]')?.removeAttribute('data-wb-frame-label');
  return node;
}
