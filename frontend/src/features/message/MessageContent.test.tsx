import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { openExternal } from "../../lib/externalLinks";

vi.mock("../../lib/externalLinks", () => ({ openExternal: vi.fn() }));
import { MessageContent } from "./MessageContent";

describe("MessageContent image viewer", () => {
  function open() {
    render(<MessageContent content="https://example.com/second.png" attachments={["/uploads/first.png"]} />);
    fireEvent.click(screen.getAllByRole("button", { name: "View attachment" })[0]);
    return screen.getByRole("dialog", { name: "Image viewer" });
  }

  it("opens on image click, closes on Escape and restores focus", () => {
    open();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View attachment" })[0]).toHaveFocus();
  });

  it("closes on backdrop but not image clicks", () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole("img"));
    expect(dialog).toBeInTheDocument();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("navigates with arrows, wraps, and resets zoom", () => {
    const dialog = open();
    fireEvent.doubleClick(within(dialog).getByRole("img"), { clientX: 400, clientY: 300 });
    expect(within(dialog).getByRole("img").style.transform).toContain("scale(2)");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute("src", "https://example.com/second.png");
    expect(screen.getByRole("dialog").querySelector("img")!.style.transform).toContain("scale(1)");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("opens the current image with the externalLinks helper", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Open in browser" }));
    expect(openExternal).toHaveBeenCalledWith(screen.getByRole("dialog").querySelector("img")!.getAttribute("src"));
  });
});

describe("MessageContent mentions", () => {
  it("highlights only server-validated usernames, not nonmembers or lookalikes", () => {
    const { container } = render(<MessageContent content="@alice @outsider @alice2 @Alice" mentionUsernames={["alice"]} />);
    expect(screen.getByText("@alice")).toHaveStyle({ fontWeight: 600 });
    expect(container.querySelectorAll("span")).toHaveLength(1);
    expect(container).toHaveTextContent("@outsider @alice2 @Alice");
  });

  it("leaves unresolved mentions plain and removes stale highlights after editing", () => {
    const { container, rerender } = render(<MessageContent content="hi @alice" mentionUsernames={["alice"]} />);
    expect(container.querySelectorAll("span")).toHaveLength(1);
    rerender(<MessageContent content="hi @alice" mentionUsernames={[]} />);
    expect(container.querySelectorAll("span")).toHaveLength(0);
    rerender(<MessageContent content="@unresolved" />);
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });
});
