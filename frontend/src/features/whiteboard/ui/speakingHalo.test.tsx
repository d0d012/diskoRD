import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionState, RoomEvent, type Room } from 'livekit-client';
import { attachVoiceSpeaking, useVoiceSpeakingStore } from '../../../stores/voiceSpeakingStore';
import { PresenceLayer } from '../render/overlays/PresenceLayer';
import { fakePresenceAdapter, participant } from '../render/overlays/presenceTestUtils';
import { createHarness } from '../input/testUtils';

afterEach(() => { cleanup(); useVoiceSpeakingStore.setState({ userIds: new Set() }); });
function fakeRoom() {
  const listeners = new Map<string, Set<() => void>>();
  const remote = { identity: 'remote', isSpeaking: true };
  const room = {
    state: ConnectionState.Connected,
    remoteParticipants: new Map([['remote', remote]]),
    on(event: string, listener: () => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); return room; },
    off(event: string, listener: () => void) { listeners.get(event)?.delete(listener); return room; },
  };
  return { room, remote, emit: (event: string) => listeners.get(event)?.forEach(listener => listener()), count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
}
describe('speaking halo', () => {
  it('matches LiveKit identities to board userIds, clears on silence/disconnect, and skips self', () => {
    const voice = fakeRoom();
    const detach = attachVoiceSpeaking(voice.room as unknown as Room);
    const h = createHarness([]);
    const fake = fakePresenceAdapter([participant(), participant({ userId: 'other', name: 'Other' }), participant({ userId: 'self' })]);
    const v = render(<PresenceLayer adapter={fake.adapter} runtime={h.runtime} store={h.store} selfUserId="self" />);
    const pill = v.getByText('Ada');
    expect(pill).toHaveAttribute('data-speaking');
    expect(v.getByText('Other')).not.toHaveAttribute('data-speaking');
    expect(v.container.querySelector('[data-wb-presence-user="self"]')).toBeNull();
    act(() => { voice.remote.isSpeaking = false; voice.emit(RoomEvent.ActiveSpeakersChanged); });
    expect(pill).not.toHaveAttribute('data-speaking');
    act(() => { voice.remote.isSpeaking = true; voice.emit(RoomEvent.ActiveSpeakersChanged); });
    expect(pill).toHaveAttribute('data-speaking');
    act(() => { voice.room.state = ConnectionState.Disconnected; voice.emit(RoomEvent.Disconnected); });
    expect(pill).not.toHaveAttribute('data-speaking');
    act(detach);
    expect(voice.count()).toBe(0);
  });
  it('does not let old-room cleanup erase the new room speaking state', () => {
    const first = fakeRoom(); const second = fakeRoom();
    const offFirst = attachVoiceSpeaking(first.room as unknown as Room);
    const offSecond = attachVoiceSpeaking(second.room as unknown as Room);
    offFirst();
    expect(useVoiceSpeakingStore.getState().userIds.has('remote')).toBe(true);
    offSecond();
    expect(useVoiceSpeakingStore.getState().userIds.size).toBe(0);
  });
});
