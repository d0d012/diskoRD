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
});
