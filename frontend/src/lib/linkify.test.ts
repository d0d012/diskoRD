import { describe, expect, it } from "vitest";
import { linkify } from "./linkify";

const links = (text: string) => linkify(text).filter((p) => p.type === "link").map((p) => p.type === "link" && [p.text, p.href]);

describe("linkify", () => {
  it("links full URLs as-is", () => {
    expect(links("see https://www.youtube.com/watch?v=PxXqEtJdswg&list=RD&index=3 now")).toEqual([
      ["https://www.youtube.com/watch?v=PxXqEtJdswg&list=RD&index=3", "https://www.youtube.com/watch?v=PxXqEtJdswg&list=RD&index=3"],
    ]);
  });

  it("links bare domains with an https href, keeping the original text", () => {
    expect(links("YouTube.com")).toEqual([["YouTube.com", "https://YouTube.com"]]);
    expect(links("www.ahmertezcan.com and primevideo.com")).toEqual([
      ["www.ahmertezcan.com", "https://www.ahmertezcan.com"],
      ["primevideo.com", "https://primevideo.com"],
    ]);
    expect(links("go to example.com.tr/path?q=1#x")).toEqual([["example.com.tr/path?q=1#x", "https://example.com.tr/path?q=1#x"]]);
  });

  it("drops trailing sentence punctuation but keeps balanced parens", () => {
    expect(links("try ahmet.com.")).toEqual([["ahmet.com", "https://ahmet.com"]]);
    expect(links("(see https://x.com/a)")).toEqual([["https://x.com/a", "https://x.com/a"]]);
    expect(links("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
      ["https://en.wikipedia.org/wiki/Foo_(bar)", "https://en.wikipedia.org/wiki/Foo_(bar)"],
    ]);
  });

  it("does not linkify file names, versions or emails", () => {
    expect(links("open notes.txt, version 1.2.3, mail me@example.com")).toEqual([]);
  });

  it("links every occurrence and preserves all text", () => {
    const text = "a.com b a.com";
    const parts = linkify(text);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(links(text)).toHaveLength(2);
  });
});
