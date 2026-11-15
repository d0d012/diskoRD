import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./api";
import { acknowledgeChannel, setReadConnection } from "./readStateAck";

vi.mock("./api", () => ({ api: { post: vi.fn().mockResolvedValue({}) } }));
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); setReadConnection("origin"); });
afterEach(() => { setReadConnection(""); vi.useRealTimers(); });

it("coalesces each channel with a trailing ack, without throttling other channels", async () => {
  acknowledgeChannel("a");
  expect(api.post).toHaveBeenCalledWith("/channels/a/ack", {}, { headers: { "X-Gateway-Connection": "origin" } });
  await vi.advanceTimersByTimeAsync(500);
  acknowledgeChannel("a"); acknowledgeChannel("a"); acknowledgeChannel("b");
  expect(api.post).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1499);
  expect(api.post).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(api.post).toHaveBeenCalledTimes(3);
});

it("cancels old-session acknowledgements when a connection is replaced", async () => {
  acknowledgeChannel("a"); acknowledgeChannel("a");
  setReadConnection("new");
  await vi.advanceTimersByTimeAsync(3000);
  expect(api.post).toHaveBeenCalledTimes(1);
});

it("allows retry after a failed acknowledgement", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error("offline"));
  acknowledgeChannel("a");
  await vi.advanceTimersByTimeAsync(1);
  acknowledgeChannel("a");
  expect(api.post).toHaveBeenCalledTimes(2);
});
