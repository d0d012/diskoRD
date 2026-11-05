import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshSession } from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { useMessageStore } from "../stores/messageStore";
import { useGateway } from "./useGateway";

vi.mock("../lib/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/api")>(),
  refreshSession: vi.fn().mockResolvedValue("fresh-token"),
}));

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.serverClose(1000));

  constructor() {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  serverClose(code: number) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code }));
  }

  message(op: string, d?: unknown, s = 1) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ op, d, s }) }));
  }
}

describe("useGateway liveness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
    useAuthStore.setState({ accessToken: "test-token" });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.setState({ accessToken: null });
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(["error", "4001"])("closes the original exactly once after replacement %s and a successful retry", async (failure) => {
    const removeMessage = vi.spyOn(useMessageStore.getState(), "removeMessage");
    const { unmount } = renderHook(() => useGateway());
    const original = MockWebSocket.instances[0];
    act(() => original.open());
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => vi.advanceTimersByTime(5000));
    const replacement = MockWebSocket.instances[1];
    expect(original.close).not.toHaveBeenCalled();

    // The old socket can still be alive after a false-positive probe timeout.
    const deleted = { id: "message-id", channelId: "channel-id" };
    act(() => original.message("MESSAGE_DELETE", deleted));
    expect(removeMessage).not.toHaveBeenCalled();

    await act(async () => {
      if (failure === "error") replacement.onerror?.();
      else replacement.serverClose(4001);
    });
    expect(refreshSession).toHaveBeenCalledTimes(failure === "4001" ? 1 : 0);
    act(() => vi.advanceTimersByTime(1000));
    expect(MockWebSocket.instances).toHaveLength(3);
    const retry = MockWebSocket.instances[2];
    expect(original.close).not.toHaveBeenCalled();
    act(() => retry.open());
    expect(original.close).toHaveBeenCalledOnce();

    act(() => {
      original.message("MESSAGE_DELETE", deleted);
      replacement.message("MESSAGE_DELETE", deleted);
      retry.message("MESSAGE_DELETE", deleted);
    });
    expect(removeMessage).toHaveBeenCalledExactlyOnceWith("message-id", "channel-id");
    // A late close from the retired original must not schedule another retry.
    act(() => vi.advanceTimersByTime(10_000));
    expect(MockWebSocket.instances).toHaveLength(3);
    unmount();
    expect(original.close).toHaveBeenCalledOnce();
  });

  it("cleans up the original while a replacement is still pending", () => {
    const { unmount } = renderHook(() => useGateway());
    const original = MockWebSocket.instances[0];
    act(() => original.open());
    act(() => window.dispatchEvent(new Event("focus")));
    act(() => vi.advanceTimersByTime(5000));
    expect(MockWebSocket.instances).toHaveLength(2);
    unmount();
    expect(original.close).toHaveBeenCalledOnce();
    expect(MockWebSocket.instances[1].close).toHaveBeenCalledOnce();
  });

  it("only probes on hidden-tab timer drift when the server responds", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useGateway());
    const original = MockWebSocket.instances[0];
    act(() => original.open());

    // Simulate minute-long timer throttling without running intervening ticks.
    for (let minute = 1; minute <= 3; minute++) {
      vi.setSystemTime(minute * 60_000);
      act(() => vi.advanceTimersToNextTimer());
      expect(original.send).toHaveBeenCalledTimes(minute);
      expect(original.send).toHaveBeenLastCalledWith(JSON.stringify({ op: "HEARTBEAT", s: minute - 1 }));
      expect(MockWebSocket.instances).toHaveLength(1);
      act(() => original.message("HEARTBEAT_ACK", undefined, minute));
      act(() => vi.advanceTimersByTime(5000));
      expect(MockWebSocket.instances).toHaveLength(1);
      expect(original.close).not.toHaveBeenCalled();
    }
  });

  it("replaces an unresponsive socket only after the hidden-tab drift probe deadline", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    renderHook(() => useGateway());
    const original = MockWebSocket.instances[0];
    act(() => original.open());
    vi.setSystemTime(60_000);
    act(() => vi.advanceTimersByTime(10_000));
    expect(original.send).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(4999));
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(original.close).not.toHaveBeenCalled();
  });
});
