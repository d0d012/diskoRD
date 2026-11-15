import type { VoiceParticipant } from "../../hooks/useVoice";
import { ParticipantTile } from "./ParticipantTile";
import { BroadcastTile } from "./BroadcastTile";
import { buildTiles, getMainTile, type VoiceTile } from "./voiceLayout";

interface StageLayoutProps {
  participants: VoiceParticipant[];
  pinnedId: string | null;
  onPin: (id: string) => void;
  onFullscreen: (id: string) => void;
}

function Tile({ tile, variant, pinnedId, onPin, onFullscreen }: {
  tile: VoiceTile;
  variant: "main" | "sidebar";
  pinnedId: string | null;
  onPin: (id: string) => void;
  onFullscreen: (id: string) => void;
}) {
  const props = {
    participant: tile.participant,
    variant,
    isPinned: tile.id === pinnedId,
    onClick: () => onPin(tile.id),
    onDoubleClick: () => onFullscreen(tile.id),
  };
  return tile.type === "broadcast" ? <BroadcastTile {...props} /> : <ParticipantTile {...props} />;
}

/**
 * Focus layout: one large tile, everyone else in a centred filmstrip below it.
 * The focused tile is never repeated in the strip, and the strip disappears
 * when nobody else is there.
 */
export function StageLayout({ participants, pinnedId, onPin, onFullscreen }: StageLayoutProps) {
  const tiles = buildTiles(participants);
  const main = getMainTile(tiles, pinnedId);
  const others = main ? tiles.filter((tile) => tile.id !== main.id) : tiles;

  return (
    <div data-testid="stage-layout" className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="min-h-0 flex-1">
        {main && (
          <div className="h-full w-full overflow-hidden rounded-xl">
            <Tile tile={main} variant="main" pinnedId={pinnedId} onPin={onPin} onFullscreen={onFullscreen} />
          </div>
        )}
      </div>

      {others.length > 0 && (
        <div data-testid="stage-filmstrip" className="flex shrink-0 justify-center overflow-x-auto">
          <div className="flex gap-2 px-1 pb-1">
            {others.map((tile) => (
              <div
                key={tile.id}
                style={{ aspectRatio: "16 / 9" }}
                className="h-[clamp(72px,14vh,120px)] shrink-0 overflow-hidden rounded-lg"
              >
                <Tile tile={tile} variant="sidebar" pinnedId={pinnedId} onPin={onPin} onFullscreen={onFullscreen} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
