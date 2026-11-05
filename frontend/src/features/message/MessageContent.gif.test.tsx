import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageContent } from "./MessageContent";
vi.mock("../../lib/externalLinks", () => ({ openExternal: vi.fn() }));
describe("KLIPY chat GIF rendering", () => {
  it("renders a single signed KLIPY media URL inline without link text and opens the shared lightbox", () => {
    const url = "https://static2.klipy.com/content/opaque/path.gif?sig=a%2Fb&quality=original";
    render(<MessageContent content={url} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(url)).not.toBeInTheDocument();
    const image = screen.getByRole("button", { name: "View attachment" });
    expect(image).toHaveAttribute("src", url); expect(image).toHaveStyle({ maxWidth: "min(300px, 100%)", height: "auto" });
    expect(screen.queryByRole("button", { name: "Add to favorites" })).not.toBeInTheDocument();
    fireEvent.click(image);
    expect(within(screen.getByRole("dialog", { name: "Image viewer" })).getByRole("img")).toHaveAttribute("src", url);
  });
  it("does not suppress ordinary URLs or mixed message text", () => {
    const { rerender } = render(<MessageContent content="https://example.com/a.gif" />);
    expect(screen.getByRole("link")).toBeInTheDocument();
    rerender(<MessageContent content="hi https://static.klipy.com/a.webp" />);
    expect(screen.getByRole("link")).toBeInTheDocument();
  });
});
