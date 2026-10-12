import { useEffect, useRef, useState, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
  LocalAudioTrack,
  Participant,
  RemoteParticipant,
  ConnectionState,
  type TrackPublication,
} from "livekit-client";
import { playSound } from "../lib/sounds";
import { attachSoundboard } from "../lib/soundboard";
import { useVoiceStore } from "../stores/voiceStore";
import { useNoiseCancellation } from "./useNoiseCancellation";
import { cameraDeviceId, micConstraints } from "../lib/mediaDevices";
import { useSettingsStore } from "../stores/settingsStore";
import { useCallStore } from "../stores/callStore";

export interface VoiceParticipant {
  identity: string;
  name: string;
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
  const ncCleanupRef = useRef<(() => void) | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.Disconnected
  );
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
    isNoiseCancellationEnabled,
  } = useVoiceStore();
  const { processStream } = useNoiseCancellation();
  const inputDeviceId = useSettingsStore((s) => s.inputDeviceId);

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
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;
      setParticipants([]);
      setConnectionState(ConnectionState.Disconnected);
      return;
    }

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    const cleanupSoundboard = attachSoundboard(room, useVoiceStore.getState().activeVoiceGuildId);

    room.on(RoomEvent.Connected, async () => {
      setConnectionState(ConnectionState.Connected);
      refreshParticipants();

      let rawStream: MediaStream | null = null;
      try {
        rawStream = await navigator.mediaDevices.getUserMedia(micConstraints());
        const { stream: processedStream, cleanup } =
          await processStream(rawStream);
        ncCleanupRef.current = cleanup;

        const processedTrack = processedStream.getAudioTracks()[0];
        const livekitTrack = new LocalAudioTrack(
          processedTrack,
          undefined,
          false
        );
        const pub = await room.localParticipant.publishTrack(livekitTrack, { source: Track.Source.Microphone });
        // Mute may have been toggled while the track was publishing.
        if (useVoiceStore.getState().isMuted) await pub.mute();
      } catch {
        rawStream?.getTracks().forEach((t) => t.stop());
        // Fall back to LiveKit's built-in mic handling
        room.localParticipant.setMicrophoneEnabled(!useVoiceStore.getState().isMuted).catch(() => {});
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      setConnectionState(ConnectionState.Disconnected);
      setParticipants([]);
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;
      onRoomDisconnected();
    });
    room.on(RoomEvent.Reconnecting, () =>
      setConnectionState(ConnectionState.Reconnecting)
    );
    room.on(RoomEvent.ParticipantConnected, refreshParticipants);
    room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
    room.on(RoomEvent.TrackSubscribed, refreshParticipants);
    room.on(RoomEvent.TrackUnsubscribed, refreshParticipants);
    room.on(RoomEvent.LocalTrackPublished, refreshParticipants);
    room.on(RoomEvent.LocalTrackUnpublished, refreshParticipants);
    room.on(RoomEvent.ActiveSpeakersChanged, refreshParticipants);
    room.on(RoomEvent.TrackMuted, (pub: TrackPublication) => {
      if (pub.source === Track.Source.Microphone) playSound("mute");
      refreshParticipants();
    });
    room.on(RoomEvent.TrackUnmuted, (pub: TrackPublication) => {
      if (pub.source === Track.Source.Microphone) playSound("unmute");
      refreshParticipants();
    });

    room.connect(liveKitUrl, liveKitToken);

    return () => {
      cleanupSoundboard();
      room.removeAllListeners();
      room.disconnect();
      roomRef.current = null;
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;
    };
  }, [liveKitToken, liveKitUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mic mute/unmute
  // Only toggles an already-published mic. Before that, the Connected handler publishes
  // the mic and applies the current mute state; calling setMicrophoneEnabled here would
  // publish a second microphone track and break negotiation.
  useEffect(() => {
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub?.track) return;
    (isMuted ? pub.mute() : pub.unmute()).catch(() => {});
  }, [isMuted]);

  // NC toggle mid-call — rewire the mic pipeline when NC enabled state changes
  useEffect(() => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;

    let cancelled = false;
    let rawStream: MediaStream | null = null;

    async function rewireMic() {
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;

      const micPub = room!.localParticipant.getTrackPublication(Track.Source.Microphone);

      try {
        rawStream = await navigator.mediaDevices.getUserMedia(micConstraints());
        if (cancelled) { rawStream.getTracks().forEach(t => t.stop()); return; }
        const { stream: processedStream, cleanup } = await processStream(rawStream);
        if (cancelled) { cleanup(); rawStream.getTracks().forEach(t => t.stop()); return; }
        ncCleanupRef.current = cleanup;
        const processedTrack = processedStream.getAudioTracks()[0];
        if (micPub?.track) {
          await (micPub.track as LocalAudioTrack).replaceTrack(processedTrack);
        } else {
          const livekitTrack = new LocalAudioTrack(processedTrack, undefined, false);
          await room!.localParticipant.publishTrack(livekitTrack, { source: Track.Source.Microphone });
        }
      } catch {
        rawStream?.getTracks().forEach(t => t.stop());
      }
    }

    rewireMic();
    return () => { cancelled = true; };
  }, [isNoiseCancellationEnabled, inputDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Camera — fixed 720p / 30fps
  useEffect(() => {
    roomRef.current?.localParticipant.setCameraEnabled(isCameraOn, {
      deviceId: cameraDeviceId(),
      resolution: { width: 1280, height: 720, frameRate: 30 },
    }).catch(() => {
      // Denied or busy camera: don't leave the button showing "on".
      useVoiceStore.getState().setCameraOn(false);
      useCallStore.getState().setNotice("Couldn't turn on your camera. Check Settings → Permissions.");
    });
  }, [isCameraOn]);

  // Screen share — uses store resolution, fps, and audio settings
  useEffect(() => {
    const resolutionMap = {
      "720": { width: 1280, height: 720 },
      "1080": { width: 1920, height: 1080 },
      "1440": { width: 2560, height: 1440 },
      source: { width: 0, height: 0 },
    };
    const { width, height } = resolutionMap[screenShareResolution];
    const resolution = width
      ? { width, height, frameRate: screenShareFps }
      : { width: 99999, height: 99999, frameRate: screenShareFps };
    roomRef.current?.localParticipant.setScreenShareEnabled(isScreenSharing, {
      audio: screenShareAudio,
      resolution,
    });
  }, [isScreenSharing, screenShareFps, screenShareResolution, screenShareAudio]);

  return { participants, connectionState };
}
