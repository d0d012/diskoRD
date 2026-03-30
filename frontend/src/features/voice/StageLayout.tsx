import type { VoiceParticipant } from "../../hooks/useVoice";
import { ParticipantTile } from "./ParticipantTile";
import { getMainParticipant } from "./voiceLayout";

interface StageLayoutProps {
  participants: VoiceParticipant[];
  pinnedId: string | null;
  onPin: (identity: string) => void;
  onFullscreen: (identity: string) => void;
}

export function StageLayout({ participants, pinnedId, onPin, onFullscreen }: StageLayoutProps) {
  const main = getMainParticipant(participants, pinnedId);

  return (
    <div data-testid="stage-layout" className="flex h-full">
      {/* Main stage */}
      <div className="flex-1 p-3 min-w-0">
        {main && (
          <div className="w-full h-full rounded-xl overflow-hidden">
            <ParticipantTile
              participant={main}
              variant="main"
              isPinned={main.identity === pinnedId}
              onClick={() => onPin(main.identity)}
              onDoubleClick={() => onFullscreen(main.identity)}
            />
          </div>
        )}
      </div>

      {/* Sidebar strip */}
      <div
        className="w-[120px] flex-shrink-0 flex flex-col gap-2 py-3 pr-3 overflow-y-auto"
        style={{ borderLeft: "1px solid var(--color-dc-bg-floating)" }}
      >
        {participants.map((p) => (
          <div
            key={p.identity}
            style={{ aspectRatio: "16 / 9" }}
            className="rounded-lg overflow-hidden flex-shrink-0"
          >
            <ParticipantTile
              participant={p}
              variant="sidebar"
              isPinned={p.identity === pinnedId}
              onClick={() => onPin(p.identity)}
              onDoubleClick={() => onFullscreen(p.identity)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
