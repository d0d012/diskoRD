import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeMeasurer } from '../../editing/fakeMeasurer';
import { setTextMeasurerForTests } from '../objects/textFit';
import { allObjects, image, sticky, text } from '../testObjects';
import { createGhostObject } from './ghostObject';

beforeEach(() => setTextMeasurerForTests(fakeMeasurer));
afterEach(() => setTextMeasurerForTests(null));

describe('detached drag ghost renderer', () => {
  it.each(allObjects)('paints a culled $kind without needing a live source node', object => {
    const node = createGhostObject(document, object);
    expect(node.dataset.wbRemoteGhost).toBe(object.id);
    expect(node.style.transform).toBe(`translate(${object.x}px, ${object.y}px)`);
    expect(node.style.width).toBe(`${object.w}px`);
    expect(node.style.height).toBe(`${object.h}px`);
    expect(node.querySelector('[data-wb-frame-label], [data-wb-object-id], .wb-root__object-enter')).toBeNull();
    expect(node.hasAttribute('data-wb-object-id')).toBe(false);
    if (object.kind === 'frame') expect(node.querySelector('[data-wb-frame-title]')).toHaveTextContent(object.label);
    if (['arrow', 'stroke'].includes(object.kind)) expect(node.querySelector('path')!.getAttribute('d')).not.toBe('');
  });

  it('preserves image crop/pixel style and text/physical sticky presentation', () => {
    const imageNode = createGhostObject(document, image).querySelector('img')!;
    expect(imageNode.getAttribute('src')).toBe(image.url);
    expect(imageNode.style.imageRendering).toBe('pixelated');
    expect(createGhostObject(document, text).querySelector('[data-wb-text]')).toHaveTextContent(text.text);
    const stickyNode = createGhostObject(document, sticky);
    expect(stickyNode.querySelector('[data-wb-text]')).toHaveTextContent(sticky.text);
    expect(stickyNode.querySelector('.wb-root__sticky')).toHaveAttribute('data-lifted', 'true');
  });
});
