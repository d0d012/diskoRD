import { api } from "./api";

let connectionId = "";
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const lastSent = new Map<string, number>();

export function setReadConnection(id: string) {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
  lastSent.clear();
  connectionId = id;
}

/** Trailing coalescing is essential: a second viewed message must not be lost. */
export function acknowledgeChannel(channelId: string) {
  if (pending.has(channelId)) return;
  const send = () => {
    pending.delete(channelId);
    lastSent.set(channelId, Date.now());
    void api.post(`/channels/${channelId}/ack`, {}, {
      headers: { "X-Gateway-Connection": connectionId },
    }).catch(() => {
      // Reconcile on the next focus/READY, without an unbounded retry loop.
      lastSent.delete(channelId);
    });
  };
  const delay = Math.max(0, (lastSent.get(channelId) ?? 0) + 2000 - Date.now());
  if (delay === 0) send();
  else pending.set(channelId, setTimeout(send, delay));
}
