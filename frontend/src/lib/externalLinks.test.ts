import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { installExternalLinkHandler, openExternal } from "./externalLinks";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

function link(href: string, onClick?: (e: MouseEvent) => void) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.textContent = "link";
  if (onClick) a.addEventListener("click", onClick);
  document.body.appendChild(a);
  return a;
}
function click(el: Element) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  el.dispatchEvent(event);
  return event;
}

let uninstall: () => void;
afterEach(() => {
  uninstall?.();
  document.body.innerHTML = "";
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
  vi.mocked(openUrl).mockClear();
});

describe("desktop", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    uninstall = installExternalLinkHandler();
  });

  it("opens external links in the default browser", () => {
    const event = click(link("https://example.com/page"));
    expect(event.defaultPrevented).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/page");
  });

  it("handles clicks on elements nested inside a link", () => {
    const span = document.createElement("span");
    link("https://example.com/").appendChild(span);
    click(span);
    expect(openUrl).toHaveBeenCalledWith("https://example.com/");
  });

  it("leaves links a component already handled, e.g. in-app invites", () => {
    click(link("https://example.com/invite/abc", (e) => e.preventDefault()));
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("ignores same-origin and non-web links", () => {
    click(link(`${window.location.origin}/sounds/soundboard/CREDITS.txt`));
    click(link("javascript:void(0)"));
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("opens programmatic links through the opener", () => {
    openExternal("https://example.com/image.png");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/image.png");
  });
});

describe("web", () => {
  it("keeps normal browser behavior", () => {
    uninstall = installExternalLinkHandler();
    const event = click(link("https://example.com/"));
    expect(event.defaultPrevented).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("opens programmatic links in a new tab", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    openExternal("https://example.com/");
    expect(open).toHaveBeenCalledWith("https://example.com/", "_blank", "noopener,noreferrer");
    expect(openUrl).not.toHaveBeenCalled();
  });
});
