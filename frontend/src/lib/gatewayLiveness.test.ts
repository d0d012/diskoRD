import { afterEach, describe, expect, it, vi } from "vitest";
import { createGatewayLiveness, createOnlineHandler, reconnectOnSleepDrift } from "./gatewayLiveness";

describe("gateway liveness", () => {
  afterEach(() => vi.useRealTimers());

  it("reconnects only when a resume heartbeat gets no server response", () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const send = vi.fn();
    const liveness = createGatewayLiveness(reconnect);

    liveness.probe(send);
    expect(send).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(4999);
    expect(reconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("accepts any server message as proof the connection is live", () => {
    vi.useFakeTimers();
    const reconnect = vi.fn();
    const liveness = createGatewayLiveness(reconnect);

    liveness.probe(vi.fn());
    vi.advanceTimersByTime(4000);
    liveness.receivedMessage();
    vi.advanceTimersByTime(2000);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("replaces the socket after timer suspension, but not during a normal interval", () => {
    vi.useFakeTimers();
    const replaceSocket = vi.fn();
    expect(reconnectOnSleepDrift(10_000, 20_000, 10_000, replaceSocket)).toBe(false);
    vi.advanceTimersByTime(30_001);
    expect(reconnectOnSleepDrift(10_000, 40_001, 10_000, replaceSocket)).toBe(true);
    expect(replaceSocket).toHaveBeenCalledOnce();
  });

  it("forces a liveness check from the online event wrapper", () => {
    const reconnect = vi.fn();
    const onOnline = createOnlineHandler(reconnect);
    onOnline();
    expect(reconnect).toHaveBeenCalledWith(true);
  });
});
