import { Component, type ReactNode } from "react";
import { AudioTile } from "./AudioTile";
import type { VoiceParticipant } from "../../hooks/useVoice";

class AudioErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  render() { return this.state.crashed ? null : this.props.children; }
}

interface Props {
  participants: VoiceParticipant[];
}

export function GlobalVoiceAudio({ participants }: Props) {
  const remote = participants.filter((p) => !p.isLocal);
  const hasSomething = remote.some((p) => p.audioTrack || p.screenAudioTrack);
  if (!hasSomething) return null;

  return (
    <AudioErrorBoundary>
      {remote.map((p) => (
        <AudioErrorBoundary key={p.identity}>
          {p.audioTrack && <AudioTile key={`mic-${p.identity}`} track={p.audioTrack} userId={p.identity} />}
          {p.screenAudioTrack && <AudioTile key={`screen-${p.identity}`} track={p.screenAudioTrack} userId={`screen-${p.identity}`} />}
        </AudioErrorBoundary>
      ))}
    </AudioErrorBoundary>
  );
}
