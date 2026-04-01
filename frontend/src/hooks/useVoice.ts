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
  audioTrack: Track | null;
  screenAudioTrack: Track | null;
}

function buildParticipant(p: Participant, isLocal: boolean): VoiceParticipant {
  let cameraTrack: Track | null = null;
  let screenTrack: Track | null = null;
  let audioTrack: Track | null = null;
  let screenAudioTrack: Track | null = null;

  for (const pub of p.trackPublications.values()) {
    if (!pub.track) continue;
    if (pub.source === Track.Source.Camera) cameraTrack = pub.track;
    if (pub.source === Track.Source.ScreenShare) screenTrack = pub.track;
    if (pub.source === Track.Source.Microphone) audioTrack = pub.track;
    if (pub.source === Track.Source.ScreenShareAudio) screenAudioTrack = pub.track;
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
    audioTrack,
    screenAudioTrack,
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
    isCameraOn,
    isScreenSharing,
    screenShareFps,
    screenShareResolution,
    screenShareAudio,
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
      const { isMuted } = useVoiceStore.getState();
      room.localParticipant.setMicrophoneEnabled(!isMuted);
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
    room.on(RoomEvent.TrackMuted, refreshParticipants);
    room.on(RoomEvent.TrackUnmuted, refreshParticipants);

    room.connect(liveKitUrl, liveKitToken);

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


  // Camera — fixed 720p / 30fps
  useEffect(() => {
    roomRef.current?.localParticipant.setCameraEnabled(isCameraOn, {
      resolution: { width: 1280, height: 720, frameRate: 30 },
    });
  }, [isCameraOn]);

  // Screen share — uses store resolution, fps, and audio settings
  useEffect(() => {
    const resolutionMap = {
      "720":   { width: 1280, height: 720 },
      "1080":  { width: 1920, height: 1080 },
      "1440":  { width: 2560, height: 1440 },
      "source": { width: 0, height: 0 },   // 0 = let browser pick native
    };
    const { width, height } = resolutionMap[screenShareResolution];
    const resolution = width
      ? { width, height, frameRate: screenShareFps }
      : { width: 99999, height: 99999, frameRate: screenShareFps }; // source: unconstrained
    roomRef.current?.localParticipant.setScreenShareEnabled(isScreenSharing, {
      audio: screenShareAudio,
      resolution,
    });
  }, [isScreenSharing, screenShareFps, screenShareResolution, screenShareAudio]);

  return { participants, connectionState };
}
