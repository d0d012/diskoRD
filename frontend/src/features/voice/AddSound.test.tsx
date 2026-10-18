import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AddSound } from "./AddSound";
import { api } from "../../lib/api";
import { decodeSoundFile, renderSoundClip } from "../../lib/soundboardUpload";
import { useSoundboardStore } from "../../stores/soundboardStore";
import { useVoiceStore } from "../../stores/voiceStore";
vi.mock("../../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("../../lib/soundboardUpload", () => ({
  decodeSoundFile: vi.fn(),
  renderSoundClip: vi.fn(),
  computePeaks: vi.fn(() => new Float32Array(1200)),
  MAX_SOUND_SECONDS: 15,
  PEAK_RESOLUTION: 0.05,
}));
const file = new File(["audio"], "Quack.mp3", { type: "audio/mpeg" });
const originalRefresh = useSoundboardStore.getState().refresh;

class FakeSourceNode {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn((n: unknown) => n);
  start = vi.fn();
  stop = vi.fn();
}
class FakeContext {
  currentTime = 0;
  destination = {};
  sources: FakeSourceNode[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createBufferSource() { const n = new FakeSourceNode(); this.sources.push(n); return n; }
  createGain() { return { gain: { value: 1 }, connect: vi.fn((n: unknown) => n) }; }
}
let context: FakeContext;

function buffer(duration: number) {
  return { duration } as AudioBuffer;
}

beforeEach(() => {
  vi.clearAllMocks();
  context = new FakeContext();
  vi.stubGlobal("AudioContext", vi.fn(function () { return context; }));
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.mocked(decodeSoundFile).mockResolvedValue(buffer(60));
  vi.mocked(renderSoundClip).mockResolvedValue({ audio: "base64", duration: 15, blob: new Blob(["wav"]) });
  useSoundboardStore.setState({ refresh: vi.fn(async () => {}), volume: 0.5 });
  useVoiceStore.setState({ isDeafened: false });
});
afterEach(() => { cleanup(); useSoundboardStore.setState({ refresh: originalRefresh }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("selects the first 15 seconds of a long clip and uploads only the trimmed part", async () => {
  const onDone = vi.fn();
  vi.mocked(api.post).mockResolvedValue({ data: {} });
  render(<AddSound guildId="guild" onDone={onDone} />);
  fireEvent.change(screen.getByLabelText("Audio file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText("Sound name")).toHaveValue("Quack"));
  expect(screen.getByRole("slider", { name: "Clip end" })).toHaveAttribute("aria-valuenow", "15");
  expect(api.post).not.toHaveBeenCalled();

  // Move the selection 1 second to the right with the keyboard.
  fireEvent.keyDown(screen.getByRole("group", { name: /Selected clip/ }), { key: "ArrowRight", shiftKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Add sound" }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(renderSoundClip).toHaveBeenCalledWith(expect.anything(), 1, 16);
  expect(api.post).toHaveBeenCalledWith("/guilds/guild/sounds", { name: "Quack", audio: "base64" }, { signal: expect.anything() });
});

it("previews only the selection and stops on a second click", async () => {
  render(<AddSound guildId="guild" onDone={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Audio file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(context.sources[0].start).toHaveBeenCalledWith(0, 0, 15);
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(context.sources[0].stop).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
});

it("shows decode errors and leaves upload disabled", async () => {
  vi.mocked(decodeSoundFile).mockRejectedValue(new Error("Choose a file shorter than 5 minutes."));
  render(<AddSound guildId="guild" onDone={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Audio file"), { target: { files: [file] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("5 minutes");
  expect(screen.getByRole("button", { name: "Add sound" })).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
});

it("keeps the selection on upload failure so members can retry", async () => {
  vi.mocked(api.post).mockRejectedValue({ response: { data: { error: "this server has reached its 64-sound limit" } } });
  render(<AddSound guildId="guild" onDone={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Audio file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Add sound" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Add sound" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("64-sound limit");
  expect(screen.getByRole("button", { name: "Add sound" })).toBeEnabled();
  expect(screen.getByRole("slider", { name: "Clip end" })).toHaveAttribute("aria-valuenow", "15");
});

it("stops the preview and closes the audio context when closed", async () => {
  const { unmount } = render(<AddSound guildId="guild" onDone={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Audio file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  unmount();
  expect(context.sources[0].stop).toHaveBeenCalled();
  expect(context.close).toHaveBeenCalled();
});
