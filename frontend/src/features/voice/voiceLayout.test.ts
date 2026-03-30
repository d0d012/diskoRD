import { describe, it, expect } from "vitest";
import { getLayoutMode, getGridColumns, getMainParticipant } from "./voiceLayout";
import type { VoiceParticipant } from "../../hooks/useVoice";

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

describe("getLayoutMode", () => {
  it("returns grid when all participants are audio-only", () => {
    expect(getLayoutMode([mkp(), mkp({ identity: "u2" })])).toBe("grid");
  });
  it("returns grid for empty array", () => {
    expect(getLayoutMode([])).toBe("grid");
  });
  it("returns stage when any participant has a camera track", () => {
    expect(getLayoutMode([mkp({ cameraTrack: {} as any })])).toBe("stage");
  });
  it("returns stage when any participant has a screen track", () => {
    expect(getLayoutMode([mkp({ screenTrack: {} as any })])).toBe("stage");
  });
});

describe("getGridColumns", () => {
  it("returns 1 for 0 or 1 participant", () => {
    expect(getGridColumns(0)).toBe(1);
    expect(getGridColumns(1)).toBe(1);
  });
  it("returns 2 for 2-4 participants", () => {
    expect(getGridColumns(2)).toBe(2);
    expect(getGridColumns(4)).toBe(2);
  });
  it("returns 3 for 5+ participants", () => {
    expect(getGridColumns(5)).toBe(3);
    expect(getGridColumns(9)).toBe(3);
  });
});

describe("getMainParticipant", () => {
  it("returns null for empty array", () => {
    expect(getMainParticipant([], null)).toBeNull();
  });
  it("returns pinned participant when pinnedId matches", () => {
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b" });
    expect(getMainParticipant([a, b], "b")).toBe(b);
  });
  it("falls back to screen sharer when pinnedId not found", () => {
    const track = {} as any;
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b", screenTrack: track });
    expect(getMainParticipant([a, b], "nonexistent")).toBe(b);
  });
  it("prefers screen share over camera track", () => {
    const track = {} as any;
    const a = mkp({ identity: "a", cameraTrack: track });
    const b = mkp({ identity: "b", screenTrack: track });
    expect(getMainParticipant([a, b], null)).toBe(b);
  });
  it("falls back to camera when no screen share", () => {
    const track = {} as any;
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b", cameraTrack: track });
    expect(getMainParticipant([a, b], null)).toBe(b);
  });
  it("falls back to speaking participant", () => {
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b", isSpeaking: true });
    expect(getMainParticipant([a, b], null)).toBe(b);
  });
  it("falls back to first participant when no other signal", () => {
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b" });
    expect(getMainParticipant([a, b], null)).toBe(a);
  });
});
