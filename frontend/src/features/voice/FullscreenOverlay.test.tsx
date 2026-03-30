import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FullscreenOverlay } from "./FullscreenOverlay";
import type { VoiceParticipant } from "../../hooks/useVoice";

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
    ...overrides,
  };
}

describe("FullscreenOverlay", () => {
  it("renders participant name", () => {
    render(<FullscreenOverlay participant={mkp({ name: "Alice" })} onClose={vi.fn()} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders with data-testid fullscreen-overlay", () => {
    render(<FullscreenOverlay participant={mkp()} onClose={vi.fn()} />);
    expect(screen.getByTestId("fullscreen-overlay")).toBeInTheDocument();
  });

  it("calls onClose when the exit button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FullscreenOverlay participant={mkp()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /exit/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FullscreenOverlay participant={mkp()} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
