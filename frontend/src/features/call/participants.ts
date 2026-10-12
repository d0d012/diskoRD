import { Track, type Participant } from "livekit-client";
import type { VoiceParticipant } from "../../hooks/useVoice";

export function buildParticipant(p: Participant, isLocal: boolean): VoiceParticipant {
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
