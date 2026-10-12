import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useSoundboardStore } from "./soundboardStore";
vi.mock("../lib/api", () => ({ api: { get: vi.fn() } }));
function session() { return { play: vi.fn(async () => {}), stop: vi.fn() }; }
beforeEach(() => {
  vi.clearAllMocks();
  useSoundboardStore.setState({ guildId: "one", session: session(), sounds: [], loading: false, catalogError: null });
});
it("ignores responses from a guild/session that has been left", async () => {
  let resolve!: (response: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  const refreshing = useSoundboardStore.getState().refresh();
  useSoundboardStore.setState({ guildId: "two", session: session(), sounds: [], loading: false });
  resolve({ data: { data: [{ id: "old" }] } });
  await refreshing;
  expect(useSoundboardStore.getState().sounds).toEqual([]);
  expect(useSoundboardStore.getState().loading).toBe(false);
});
it("keeps the newest catalog when overlapping refreshes finish out of order", async () => {
  let resolve!: (response: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  const old = useSoundboardStore.getState().refresh();
  vi.mocked(api.get).mockResolvedValueOnce({ data: { data: [{ id: "new" }] } });
  await useSoundboardStore.getState().refresh();
  resolve({ data: { data: [{ id: "deleted" }] } }); await old;
  expect(useSoundboardStore.getState().sounds).toEqual([{ id: "new" }]);
});
it("reports catalog errors without preventing built-in playback", async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"));
  await useSoundboardStore.getState().refresh();
  expect(useSoundboardStore.getState().catalogError).toContain("Couldn't load");
  expect(useSoundboardStore.getState().session).not.toBeNull();
  expect(useSoundboardStore.getState().loading).toBe(false);
});
