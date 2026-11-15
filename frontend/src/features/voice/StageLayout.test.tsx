import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StageLayout } from "./StageLayout";
import type { VoiceParticipant } from "../../hooks/useVoice";

function mkp(identity: string, name: string): VoiceParticipant {
  return {
    identity, name, isSpeaking: false, isMicEnabled: true, isCameraEnabled: false, isScreenSharing: false,
    isLocal: false, cameraTrack: null, screenTrack: null, audioTrack: null, screenAudioTrack: null,
  };
}

describe("StageLayout", () => {
  it("hides the filmstrip when only the focused participant is present", () => {
    render(<StageLayout participants={[mkp("a", "Alice")]} pinnedId={null} onPin={vi.fn()} onFullscreen={vi.fn()} />);
    expect(screen.getAllByTestId("participant-tile-a")).toHaveLength(1);
    expect(screen.queryByTestId("stage-filmstrip")).toBeNull();
  });

  it("never repeats the focused participant in the filmstrip", () => {
    render(
      <StageLayout participants={[mkp("a", "Alice"), mkp("b", "Bob"), mkp("c", "Cem")]} pinnedId="b" onPin={vi.fn()} onFullscreen={vi.fn()} />,
    );
    const strip = screen.getByTestId("stage-filmstrip");
    expect(screen.getAllByTestId("participant-tile-b")).toHaveLength(1);
    expect(within(strip).queryByTestId("participant-tile-b")).toBeNull();
    expect(within(strip).getByTestId("participant-tile-a")).toBeInTheDocument();
    expect(within(strip).getByTestId("participant-tile-c")).toBeInTheDocument();
  });
});
