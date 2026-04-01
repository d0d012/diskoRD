import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FullscreenOverlay } from "./FullscreenOverlay";
import type { VoiceParticipant } from "../../hooks/useVoice";
import type { VoiceTile } from "./voiceLayout";

vi.mock("../../stores/voiceStore", () => ({
  useVoiceStore: () => ({
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    setMuted: vi.fn(),
    setDeafened: vi.fn(),
    setCameraOn: vi.fn(),
    setScreenSharing: vi.fn(),
    leaveVoice: vi.fn(),
  }),
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

function mkTile(overrides: Partial<VoiceParticipant> = {}): VoiceTile {
  return { type: "participant", participant: mkp(overrides), id: overrides.identity ?? "u1" };
}

describe("FullscreenOverlay", () => {
  it("renders participant name", () => {
    render(<FullscreenOverlay tile={mkTile({ name: "Alice" })} onClose={vi.fn()} />);
    expect(screen.getByTestId("participant-name-label")).toBeInTheDocument();
    expect(screen.getByTestId("participant-name-label")).toHaveTextContent("Alice");
  });

  it("renders with data-testid fullscreen-overlay", () => {
    render(<FullscreenOverlay tile={mkTile()} onClose={vi.fn()} />);
    expect(screen.getByTestId("fullscreen-overlay")).toBeInTheDocument();
  });

  it("calls onClose when the exit button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FullscreenOverlay tile={mkTile()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /exit/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FullscreenOverlay tile={mkTile()} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows broadcast tile name for screen share tiles", () => {
    const tile: VoiceTile = { type: "broadcast", participant: mkp({ name: "Bob" }), id: "broadcast-u1" };
    render(<FullscreenOverlay tile={tile} onClose={vi.fn()} />);
    expect(screen.getByTestId("participant-name-label")).toHaveTextContent("Bob's Screen");
  });
});
