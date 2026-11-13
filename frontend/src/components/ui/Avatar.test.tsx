import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Avatar } from "./Avatar";

vi.mock("../../lib/api", () => ({
  resolveMediaUrl: (url: string | null | undefined) => url ?? undefined,
}));

describe("Avatar", () => {
  it("renders an image when src is set", () => {
    const { container } = render(<Avatar name="bob" src="/uploads/avatars/u1/a.png" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/uploads/avatars/u1/a.png");
  });

  it("falls back to the colored initial when the image fails", () => {
    const { container } = render(<Avatar name="bob" src="/uploads/avatars/u1/a.png" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();

    fireEvent.error(img!);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("B");
  });

  it("renders the initial when no src is given", () => {
    const { container } = render(<Avatar name="carol" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("C");
  });

  it.each([
    ["online", "Online", "circle"],
    ["idle", "Away", "path"],
    ["dnd", "Do Not Disturb", "rect"],
    ["offline", "Offline", 'circle[fill="none"]'],
    ["invisible", "Offline", 'circle[fill="none"]'],
  ])("renders the distinct %s presence shape against the host surface", (status, title, shape) => {
    const { getByTitle } = render(<Avatar name="carol" status={status} ringColor="rgb(17, 18, 20)" />);
    const dot = getByTitle(title);
    expect(dot.style.backgroundColor).toBe("rgb(17, 18, 20)");
    expect(dot.querySelector(`svg ${shape}`)).not.toBeNull();
    expect(dot.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("restarts presence motion only when the visible status changes", () => {
    const { container, rerender, getByTitle } = render(<Avatar name="carol" status="online" />);
    const online = container.querySelector("svg");
    rerender(<Avatar name="carol" status="online" />);
    expect(container.querySelector("svg")).toBe(online);
    rerender(<Avatar name="carol" status="idle" />);
    expect(getByTitle("Away")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBe(online);
  });
});
