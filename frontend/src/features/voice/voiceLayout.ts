import type { VoiceParticipant } from "../../hooks/useVoice";

export type LayoutMode = "grid" | "stage";

/** A renderable tile — either a participant tile or a broadcast (screen share) tile */
export type VoiceTile =
  | { type: "participant"; participant: VoiceParticipant; id: string }
  | { type: "broadcast"; participant: VoiceParticipant; id: string };

/** Expand participants into tiles — screensharers produce two tiles */
export function buildTiles(participants: VoiceParticipant[]): VoiceTile[] {
  const tiles: VoiceTile[] = [];
  for (const p of participants) {
    tiles.push({ type: "participant", participant: p, id: p.identity });
    if (p.isScreenSharing && p.screenTrack) {
      tiles.push({ type: "broadcast", participant: p, id: `broadcast-${p.identity}` });
    }
  }
  return tiles;
}

export function getLayoutMode(participants: VoiceParticipant[]): LayoutMode {
  return participants.some((p) => p.isCameraEnabled || p.isScreenSharing)
    ? "stage"
    : "grid";
}

export function getGridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

export function getMainTile(
  tiles: VoiceTile[],
  pinnedId: string | null
): VoiceTile | null {
  if (!tiles.length) return null;
  if (pinnedId) {
    const pinned = tiles.find((t) => t.id === pinnedId);
    if (pinned) return pinned;
  }
  // Prefer broadcast tiles (screen share)
  const broadcast = tiles.find((t) => t.type === "broadcast");
  if (broadcast) return broadcast;
  // Then camera
  const camera = tiles.find(
    (t) => t.type === "participant" && t.participant.isCameraEnabled && t.participant.cameraTrack
  );
  if (camera) return camera;
  // Then speaker
  const speaker = tiles.find((t) => t.participant.isSpeaking);
  if (speaker) return speaker;
  return tiles[0];
}
