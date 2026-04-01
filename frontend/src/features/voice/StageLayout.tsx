import type { VoiceParticipant } from "../../hooks/useVoice";
import { ParticipantTile } from "./ParticipantTile";
import { BroadcastTile } from "./BroadcastTile";
import { buildTiles, getMainTile } from "./voiceLayout";

interface StageLayoutProps {
  participants: VoiceParticipant[];
  pinnedId: string | null;
  onPin: (id: string) => void;
  onFullscreen: (id: string) => void;
}

export function StageLayout({ participants, pinnedId, onPin, onFullscreen }: StageLayoutProps) {
  const tiles = buildTiles(participants);
  const main = getMainTile(tiles, pinnedId);

  return (
    <div data-testid="stage-layout" className="flex h-full">
      {/* Main stage */}
      <div className="flex-1 p-3 min-w-0">
        {main && (
          <div className="w-full h-full rounded-xl overflow-hidden">
            {main.type === "broadcast" ? (
              <BroadcastTile
                participant={main.participant}
                variant="main"
                isPinned={main.id === pinnedId}
                onClick={() => onPin(main.id)}
                onDoubleClick={() => onFullscreen(main.id)}
              />
            ) : (
              <ParticipantTile
                participant={main.participant}
                variant="main"
                isPinned={main.id === pinnedId}
                onClick={() => onPin(main.id)}
                onDoubleClick={() => onFullscreen(main.id)}
              />
            )}
          </div>
        )}
      </div>

      {/* Sidebar strip */}
      <div
        className="w-[120px] flex-shrink-0 flex flex-col gap-2 py-3 pr-3 overflow-y-auto"
        style={{ borderLeft: "1px solid var(--color-dc-bg-floating)" }}
      >
        {tiles.map((tile) => (
          <div
            key={tile.id}
            style={{ aspectRatio: "16 / 9" }}
            className="rounded-lg overflow-hidden flex-shrink-0"
          >
            {tile.type === "broadcast" ? (
              <BroadcastTile
                participant={tile.participant}
                variant="sidebar"
                isPinned={tile.id === pinnedId}
                onClick={() => onPin(tile.id)}
                onDoubleClick={() => onFullscreen(tile.id)}
              />
            ) : (
              <ParticipantTile
                participant={tile.participant}
                variant="sidebar"
                isPinned={tile.id === pinnedId}
                onClick={() => onPin(tile.id)}
                onDoubleClick={() => onFullscreen(tile.id)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
