import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateChannelModal } from "./CreateChannelModal";
import { useGuildStore } from "../../stores/guildStore";

const createChannel = vi.fn();

beforeEach(() => {
  createChannel.mockReset();
  createChannel.mockResolvedValue({ id: "c1", guildId: "g1", name: "ideas", type: "whiteboard", position: 0 });
  useGuildStore.setState({ createChannel } as never);
});

describe("CreateChannelModal", () => {
  it("offers text, voice and board types", () => {
    render(<CreateChannelModal guildId="g1" onClose={() => undefined} />);
    expect(screen.getByRole("button", { name: /Text Channel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Voice Channel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Board/ })).toBeInTheDocument();
  });

  it("creates a whiteboard channel when Board is chosen", async () => {
    const onClose = vi.fn();
    render(<CreateChannelModal guildId="g1" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^Board/ }));
    fireEvent.change(screen.getByPlaceholderText("new-board"), { target: { value: "ideas" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Channel/ }));
    await waitFor(() => expect(createChannel).toHaveBeenCalledWith("g1", "ideas", "whiteboard"));
  });
});
