import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Soundboard } from "./Soundboard";
import { useSoundboardStore } from "../../stores/soundboardStore";
import { api } from "../../lib/api";
vi.mock("../../lib/api", () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() }, setSessionHandlers: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useSoundboardStore.setState({ session: { play: vi.fn(async () => {}), stop: vi.fn() }, guildId: null, sounds: [], loading: false,
    catalogError: null, available: true, error: null, volume: 0.5 });
});
afterEach(cleanup);

it("opens a nonblocking searchable grid, stays open on repeated plays, and offers preview mode", () => {
  render(<Soundboard />);
  const trigger = screen.getByRole("button", { name: "Soundboard" });
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Soundboard" })).toHaveAttribute("aria-modal", "false");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("button", { name: "Boop" }));
  fireEvent.click(screen.getByRole("button", { name: "Boop" }));
  expect(useSoundboardStore.getState().session!.play).toHaveBeenCalledTimes(2);
  expect(useSoundboardStore.getState().session!.play).toHaveBeenLastCalledWith("beep", false);
  fireEvent.click(screen.getByRole("button", { name: "Preview sounds only for me" }));
  fireEvent.click(screen.getByRole("button", { name: "Boop" }));
  expect(useSoundboardStore.getState().session!.play).toHaveBeenLastCalledWith("beep", true);
  fireEvent.change(screen.getByRole("textbox", { name: "Search sounds" }), { target: { value: "boop" } });
  expect(screen.queryByRole("button", { name: "Magic" })).toBeNull();
  expect(screen.getByRole("button", { name: "Boop" })).toBeEnabled();
  fireEvent.change(screen.getByRole("slider", { name: "Soundboard volume" }), { target: { value: "0" } });
  expect(useSoundboardStore.getState().volume).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Stop sounds for me" }));
  expect(useSoundboardStore.getState().session!.stop).toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it("closes on outside pointer interaction without blocking the voice controls", () => {
  render(<><Soundboard /><button>Mute mic</button></>);
  fireEvent.click(screen.getByRole("button", { name: "Soundboard" }));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Mute mic" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("allows muted local previews but disables broadcasts", () => {
  useSoundboardStore.setState({ available: false });
  render(<Soundboard />); fireEvent.click(screen.getByRole("button", { name: "Soundboard" }));
  expect(screen.getByRole("button", { name: "Boop" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Preview sounds only for me" }));
  expect(screen.getByRole("button", { name: "Boop" })).toBeEnabled();
});
it("offers inline uploads to ordinary guild members, not just owners", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { data: [] } });
  useSoundboardStore.setState({ guildId: "guild" });
  render(<Soundboard />); fireEvent.click(screen.getByRole("button", { name: "Soundboard" }));
  fireEvent.click(screen.getByRole("button", { name: "+ Add sound" }));
  expect(screen.getByLabelText("Audio file")).toBeInTheDocument();
  expect(screen.getByText(/Anyone in this server/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add sound" })).toBeDisabled();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith("/guilds/guild/sounds"));
});
it("does not expose guild uploads in DM calls", () => {
  render(<Soundboard />); fireEvent.click(screen.getByRole("button", { name: "Soundboard" }));
  expect(screen.queryByRole("button", { name: "+ Add sound" })).toBeNull();
});
it("explains disconnected state", () => {
  useSoundboardStore.setState({ session: null, available: false });
  render(<Soundboard />); fireEvent.click(screen.getByRole("button", { name: "Soundboard" }));
  expect(screen.getByRole("button", { name: "Boop" })).toBeDisabled();
  expect(screen.getByRole("status").textContent).toContain("Join voice");
});
