import type { ObjectId, PresenceFields } from '../contract';
import type { ToolContext } from './types';
import { reportRefusal } from './objects';

/** Dedupe by field, not packet: omitted fields preserve their previous values. */
export function createPresenceSender(send: (fields: PresenceFields) => void): (fields: PresenceFields) => void {
  const previous = new Map<string, string>();
  return fields => {
    const changed: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const serialized = JSON.stringify(value);
      if (previous.get(field) === serialized) continue;
      previous.set(field, serialized);
      changed[field] = value;
    }
    if (Object.keys(changed).length) send(changed as PresenceFields);
  };
}

export function isSoftLocked(ctx: ToolContext, ids: readonly ObjectId[], action: 'moving' | 'editing'): boolean {
  const owner = ctx.presence?.getParticipants().find(p => p.userId !== ctx.userId && (
    action === 'moving' ? p.drag?.ids.some(id => ids.includes(id)) : p.editingId !== null && ids.includes(p.editingId)
  ));
  if (!owner) return false;
  reportRefusal(ctx.notify, 'refused', `${owner.name} is ${action} this`);
  return true;
}
