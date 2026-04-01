import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoicePanel } from "./VoicePanel";
import { ConnectionState } from "livekit-client";
import type { VoiceParticipant } from "../../hooks/useVoice";

vi.mock("../../stores/voiceStore", () => ({
  useVoiceStore: () => ({
    activeVoiceChannelId: "ch-1",
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    isConnecting: false,
    setMuted: vi.fn(),
    setDeafened: vi.fn(),
    setCameraOn: vi.fn(),
    setScreenSharing: vi.fn(),
    leaveVoice: vi.fn(),
  }),
}));

vi.mock("../../stores/guildStore", () => ({
  useGuildStore: () => ({ channels: {}, activeGuildId: null }),
}));

function mkp(overrides: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    identity: "u1",
    name: "Alice",
    isSpeaking: false,
    isMicEnabled: true,
    isCameraEnabled: false,
    isScreenSharing: false,
    isLocal: false,
    cameraTrack: null,
    screenTrack: null,
    audioTrack: null,
    screenAudioTrack: null,
    ...overrides,
  };
}

describe("VoicePanel layout switching", () => {
  it("renders GridLayout when no participant has video or screen", () => {
    render(<VoicePanel participants={[mkp()]} connectionState={ConnectionState.Connected} />);
    expect(screen.getByTestId("grid-layout")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-layout")).toBeNull();
  });

  it("renders StageLayout when any participant has a screen track", () => {
    render(
      <VoicePanel
        participants={[mkp({ identity: "a", isScreenSharing: true, screenTrack: {} as any })]}
        connectionState={ConnectionState.Connected}
      />
    );
    expect(screen.getByTestId("stage-layout")).toBeInTheDocument();
    expect(screen.queryByTestId("grid-layout")).toBeNull();
  });

  it("renders StageLayout when any participant has a camera track", () => {
    render(
      <VoicePanel
        participants={[mkp({ identity: "a", isCameraEnabled: true, cameraTrack: {} as any })]}
        connectionState={ConnectionState.Connected}
      />
    );
    expect(screen.getByTestId("stage-layout")).toBeInTheDocument();
  });
});

describe("VoicePanel fullscreen", () => {
  it("opens FullscreenOverlay on double-click of a grid tile", async () => {
    const user = userEvent.setup();
    render(<VoicePanel participants={[mkp({ identity: "a", name: "Alice" })]} connectionState={ConnectionState.Connected} />);
    await user.dblClick(screen.getByTestId("participant-tile-a"));
    expect(screen.getByTestId("fullscreen-overlay")).toBeInTheDocument();
  });

  it("closes FullscreenOverlay when Esc is pressed", async () => {
    const user = userEvent.setup();
    render(<VoicePanel participants={[mkp({ identity: "a" })]} connectionState={ConnectionState.Connected} />);
    await user.dblClick(screen.getByTestId("participant-tile-a"));
    expect(screen.getByTestId("fullscreen-overlay")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("fullscreen-overlay")).toBeNull();
  });
});
