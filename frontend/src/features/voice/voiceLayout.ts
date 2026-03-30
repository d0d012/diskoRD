import type { VoiceParticipant } from "../../hooks/useVoice";

export type LayoutMode = "grid" | "stage";

export function getLayoutMode(participants: VoiceParticipant[]): LayoutMode {
  return participants.some(p => p.cameraTrack !== null || p.screenTrack !== null)
    ? "stage"
    : "grid";
}

export function getGridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

export function getMainParticipant(
  participants: VoiceParticipant[],
  pinnedId: string | null
): VoiceParticipant | null {
  if (!participants.length) return null;
  if (pinnedId) {
    const pinned = participants.find(p => p.identity === pinnedId);
    if (pinned) return pinned;
  }
  const screensharer = participants.find(p => p.screenTrack !== null);
  if (screensharer) return screensharer;
  const camera = participants.find(p => p.cameraTrack !== null);
  if (camera) return camera;
  const speaker = participants.find(p => p.isSpeaking);
  if (speaker) return speaker;
  return participants[0];
}
