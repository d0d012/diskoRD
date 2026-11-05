import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageContent } from "./MessageContent";

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
