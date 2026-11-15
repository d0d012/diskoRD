import { create } from 'zustand';
import { ConnectionState, RoomEvent, type Room } from 'livekit-client';

/** Read-only projection of the existing voice room, never opens another connection. */
export const useVoiceSpeakingStore = create<{ userIds: ReadonlySet<string> }>(() => ({ userIds: new Set() }));
let owner: Room | null = null;

export function attachVoiceSpeaking(room: Room): () => void {
  owner = room;
  function refresh() {
    if (owner !== room) return;
    const userIds = new Set<string>();
    if (room.state === ConnectionState.Connected) {
      for (const participant of room.remoteParticipants.values()) {
        if (participant.isSpeaking) userIds.add(participant.identity);
      }
    }
    useVoiceSpeakingStore.setState({ userIds });
  }
  const events = [RoomEvent.Connected, RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantDisconnected,
    RoomEvent.Reconnecting, RoomEvent.Reconnected, RoomEvent.Disconnected] as const;
  for (const event of events) room.on(event, refresh);
  refresh();
  return () => {
    for (const event of events) room.off(event, refresh);
    if (owner === room) { owner = null; useVoiceSpeakingStore.setState({ userIds: new Set() }); }
  };
}
