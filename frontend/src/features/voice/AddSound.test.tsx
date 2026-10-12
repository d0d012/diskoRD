import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddSound } from "./AddSound";
import { api } from "../../lib/api";
import { prepareSound } from "../../lib/soundboardUpload";
import { useSoundboardStore } from "../../stores/soundboardStore";
import { useVoiceStore } from "../../stores/voiceStore";
vi.mock("../../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../lib/soundboardUpload", () => ({ prepareSound: vi.fn() }));
const file = new File(["audio"], "Quack.mp3", { type: "audio/mpeg" });
const originalRefresh = useSoundboardStore.getState().refresh;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.mocked(prepareSound).mockResolvedValue({ audio: "base64", duration: 1, blob: new Blob(["wav"]) });
  useSoundboardStore.setState({ refresh: vi.fn(async () => {}), volume: 0.5 });
  useVoiceStore.setState({ isDeafened: false });
});
afterEach(() => { cleanup(); useSoundboardStore.setState({ refresh: originalRefresh }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("prepares locally, previews without uploading, and submits the normalized clip", async () => {
  const onDone = vi.fn();
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  render(<AddSound guildId="guild" onDone={onDone} />);
  fireEvent.change(screen.getByLabelText("Audio file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText("Sound name")).toHaveValue("Quack"));
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add sound" }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(api.post).toHaveBeenCalledWith("/guilds/guild/sounds", { name: "Quack", audio: "base64" }, { signal: expect.anything() });
});
it("shows decode errors and leaves upload disabled", async () => {
  vi.mocked(prepareSound).mockRejectedValue(new Error("Choose a sound up to 5 seconds long."));
  render(<AddSound guildId="guild" onDone={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Audio file"), { target: { files: [file] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("5 seconds");
  expect(screen.getByRole("button", { name: "Add sound" })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
});
it("preserves the prepared sound on upload failure so members can retry", async () => {
  vi.mocked(api.post).mockRejectedValue({ response: { data: { error: "this server has reached its 48-sound limit" } } });
  render(<AddSound guildId="guild" onDone={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Audio file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Add sound" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Add sound" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("48-sound limit");
  expect(screen.getByRole("button", { name: "Add sound" })).toBeEnabled();
});
it("stops previews and revokes local media when closed", async () => {
  const { unmount } = render(<AddSound guildId="guild" onDone={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Audio file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});
