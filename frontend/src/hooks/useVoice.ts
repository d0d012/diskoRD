import { useEffect, useRef, useState, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
  Participant,
  RemoteParticipant,
  ConnectionState,
} from "livekit-client";
import { useVoiceStore } from "../stores/voiceStore";

export interface VoiceParticipant {
  identity: string;   // userId
  name: string;       // username
  isSpeaking: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  isLocal: boolean;
  cameraTrack: Track | null;
  screenTrack: Track | null;
}

function buildParticipant(p: Participant, isLocal: boolean): VoiceParticipant {
  let cameraTrack: Track | null = null;
  let screenTrack: Track | null = null;

  for (const pub of p.trackPublications.values()) {
    if (!pub.track) continue;
    if (pub.source === Track.Source.Camera) cameraTrack = pub.track;
    if (pub.source === Track.Source.ScreenShare) screenTrack = pub.track;
  }

  return {
    identity: p.identity,
    name: p.name ?? p.identity,
    isSpeaking: p.isSpeaking,
    isMicEnabled: p.isMicrophoneEnabled,
    isCameraEnabled: p.isCameraEnabled,
    isScreenSharing: screenTrack !== null,
    isLocal,
    cameraTrack,
    screenTrack,
  };
}

export function useVoice() {
  const roomRef = useRef<Room | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);

  const {
    liveKitToken,
    liveKitUrl,
    isMuted,
    isDeafened,
    isCameraOn,
    isScreenSharing,
    onRoomDisconnected,
  } = useVoiceStore();

  const refreshParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    const list: VoiceParticipant[] = [
      buildParticipant(room.localParticipant, true),
    ];
    room.remoteParticipants.forEach((p: RemoteParticipant) => {
      list.push(buildParticipant(p, false));
    });
    setParticipants(list);
  }, []);

  // Connect / disconnect when token/url changes
  useEffect(() => {
    if (!liveKitToken || !liveKitUrl) {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      setParticipants([]);
      setConnectionState(ConnectionState.Disconnected);
      return;
    }

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    room.on(RoomEvent.Connected, () => {
      setConnectionState(ConnectionState.Connected);
      refreshParticipants();
    });
    room.on(RoomEvent.Disconnected, () => {
      setConnectionState(ConnectionState.Disconnected);
      setParticipants([]);
      onRoomDisconnected();
    });
    room.on(RoomEvent.Reconnecting, () => setConnectionState(ConnectionState.Reconnecting));
    room.on(RoomEvent.ParticipantConnected, refreshParticipants);
    room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
    room.on(RoomEvent.TrackSubscribed, refreshParticipants);
    room.on(RoomEvent.TrackUnsubscribed, refreshParticipants);
    room.on(RoomEvent.LocalTrackPublished, refreshParticipants);
    room.on(RoomEvent.LocalTrackUnpublished, refreshParticipants);
    room.on(RoomEvent.ActiveSpeakersChanged, refreshParticipants);

    room.connect(liveKitUrl, liveKitToken, { audio: true, video: false });

    return () => {
      room.removeAllListeners();
      room.disconnect();
      roomRef.current = null;
    };
  }, [liveKitToken, liveKitUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mic mute/unmute
  useEffect(() => {
    roomRef.current?.localParticipant.setMicrophoneEnabled(!isMuted);
  }, [isMuted]);

  // Deafen (mute all remote audio)
  useEffect(() => {
    const room = roomRef.current;
    if (!room) return;
    room.remoteParticipants.forEach((p) => p.setVolume(isDeafened ? 0 : 1));
  }, [isDeafened]);

  // Camera
  useEffect(() => {
    roomRef.current?.localParticipant.setCameraEnabled(isCameraOn);
  }, [isCameraOn]);

  // Screen share
  useEffect(() => {
    roomRef.current?.localParticipant.setScreenShareEnabled(isScreenSharing);
  }, [isScreenSharing]);

  return { participants, connectionState };
}
