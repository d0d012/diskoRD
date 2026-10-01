import { describe, it, expect, vi, beforeEach } from "vitest";

const post = vi.fn();
vi.mock("../lib/api", () => ({ api: { post: (...a: unknown[]) => post(...a) } }));
vi.mock("./voiceStore", () => ({
  useVoiceStore: { getState: () => ({ activeVoiceChannelId: null, leaveVoice: vi.fn() }) },
}));

import { useCallStore } from "./callStore";

beforeEach(() => {
  post.mockReset();
  useCallStore.setState({ state: "idle", call: null, notice: null });
});

describe("callStore", () => {
  it("shows the server's message when a call cannot start", async () => {
    post.mockRejectedValueOnce({ response: { status: 409, data: { error: "user is busy" } } });
    await useCallStore.getState().initiateCall("dm1", "u2", "bob");
    expect(useCallStore.getState().state).toBe("idle");
    expect(useCallStore.getState().notice).toBe("User is busy");
  });

  it("resets when accepting an expired call instead of sticking on ringing", async () => {
    useCallStore.getState().onIncomingCall("dm1", "u2", "bob");
    post.mockRejectedValueOnce({ response: { status: 410, data: { error: "call expired or not found" } } });
    await useCallStore.getState().acceptCall("dm1");
    expect(useCallStore.getState().state).toBe("idle");
    expect(useCallStore.getState().notice).toBeTruthy();
  });

  it("ignores end events for a different channel", () => {
    useCallStore.getState().onIncomingCall("dm1", "u2", "bob");
    useCallStore.getState().onCallAccepted("dm1", "t", "ws://x");
    useCallStore.getState().onCallEnded("dm-other");
    expect(useCallStore.getState().state).toBe("in-call");
    useCallStore.getState().onCallEnded("dm1");
    expect(useCallStore.getState().state).toBe("idle");
  });

  it("reports a missed call to the callee and no answer to the caller", () => {
    useCallStore.getState().onIncomingCall("dm1", "u2", "bob");
    useCallStore.getState().onCallTimeout("dm1");
    expect(useCallStore.getState().notice).toBe("Missed call from bob");

    useCallStore.setState({ state: "calling", call: { channelId: "dm2", recipientId: "u3", recipientName: "carol" }, notice: null });
    useCallStore.getState().onCallTimeout("dm2");
    expect(useCallStore.getState().notice).toBe("carol didn't answer");
  });

  it("ends locally when keepalive says the call is gone", async () => {
    useCallStore.setState({ state: "in-call", call: { channelId: "dm1", recipientId: "u2", recipientName: "bob" } });
    post.mockRejectedValueOnce({ response: { status: 410 } });
    await useCallStore.getState().keepalive("dm1");
    expect(useCallStore.getState().state).toBe("idle");
  });

  it("ignores an invite while already busy", () => {
    useCallStore.setState({ state: "in-call", call: { channelId: "dm1", recipientId: "u2", recipientName: "bob" } });
    useCallStore.getState().onIncomingCall("dm9", "u5", "eve");
    expect(useCallStore.getState().call?.channelId).toBe("dm1");
  });
});
