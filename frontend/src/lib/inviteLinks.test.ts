import { describe, it, expect } from "vitest";
import { parseInviteCode, PUBLIC_URL } from "./inviteLinks";

describe("parseInviteCode", () => {
  it("reads the public https link", () => {
    expect(parseInviteCode(`${PUBLIC_URL}/invite/abc123`)).toBe("abc123");
  });
  it("reads the diskord:// deep link", () => {
    expect(parseInviteCode("diskord://invite/abc123")).toBe("abc123");
  });
  it("accepts a bare code", () => {
    expect(parseInviteCode("  abc123 ")).toBe("abc123");
  });
  it("rejects invite-shaped links on other hosts", () => {
    expect(parseInviteCode("https://evil.example/invite/abc123")).toBeNull();
  });
  it("rejects junk", () => {
    expect(parseInviteCode("hello world")).toBeNull();
  });
});
