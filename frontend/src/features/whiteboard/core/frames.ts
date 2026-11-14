import type { BoardObject, FrameObject, ObjectId } from '../contract/types';

/**
 * Frame containment. Dragging a frame moves the objects whose centre lies
 * inside it at pointer-down (see the plan: frames have no parent/child tree,
 * so containment is purely spatial). Frames never contain other frames, and a
 * frame never contains itself.
 */

/**
 * Ids of objects whose centre lies inside `frame`, in the order they appear in
 * `objects`. Frames (including `frame` itself) are always excluded.
 */
export function objectsInsideFrame(frame: FrameObject, objects: readonly BoardObject[]): ObjectId[] {
  const ids: ObjectId[] = [];
  for (const object of objects) {
    if (object.kind === 'frame' || object.id === frame.id) continue;
    const centerX = object.x + object.w / 2;
    const centerY = object.y + object.h / 2;
    if (
      centerX >= frame.x
      && centerX <= frame.x + frame.w
      && centerY >= frame.y
      && centerY <= frame.y + frame.h
    ) {
      ids.push(object.id);
    }
  }
  return ids;
}
