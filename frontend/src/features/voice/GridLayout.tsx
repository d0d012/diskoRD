import type { VoiceParticipant } from "../../hooks/useVoice";
import { ParticipantTile } from "./ParticipantTile";
import { getGridColumns } from "./voiceLayout";

interface GridLayoutProps {
  participants: VoiceParticipant[];
  onFullscreen: (identity: string) => void;
}

export function GridLayout({ participants, onFullscreen }: GridLayoutProps) {
  const cols = getGridColumns(participants.length);
  const gridStyle = {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gap: "12px",
    padding: "20px",
    height: "100%",
    alignContent: "center",
  };

  return (
    <div data-testid="grid-layout" style={{ height: "100%" }}>
      {participants.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-40" style={{ height: "100%" }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-text-muted)" }}>
            <path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/>
          </svg>
          <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>No one else here yet</p>
        </div>
      ) : (
        <div style={gridStyle}>
          {participants.map((p) => (
            <div key={p.identity} style={{ aspectRatio: "16 / 9" }}>
              <ParticipantTile
                participant={p}
                variant="grid"
                onDoubleClick={() => onFullscreen(p.identity)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
