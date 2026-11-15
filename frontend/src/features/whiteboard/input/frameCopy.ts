import type { BoardObject, ObjectId } from '../contract';
import { objectsInsideFrame } from '../core';

/**
 * Expand a selected set to include, for every selected frame, the non-frame
 * objects whose centre lies inside it. This is the same spatial rule used to
 * move children with a frame (`objectsInsideFrame`), so a copied or duplicated
 * frame always carries its contents. Frames never contain other frames, so a
 * nested frame is only included when it is itself selected.
 *
 * Children that were also selected directly are deduplicated, and the result
 * keeps the store's rank order (frames first, then everything else), which is
 * what `insertCopies` needs to preserve relative z-order within each band.
 */
export function expandFrameSelection(
  objects: readonly BoardObject[],
  ids: readonly ObjectId[],
): BoardObject[] {
  const wanted = new Set(ids);
  const included = new Set<ObjectId>();
  for (const object of objects) {
    if (!wanted.has(object.id)) continue;
    included.add(object.id);
    if (object.kind === 'frame') {
      for (const inner of objectsInsideFrame(object, objects)) included.add(inner);
    }
  }
  return objects.filter(object => included.has(object.id));
}
