import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/plugin-store before importing storage
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { storage } from "./storage";

describe("storage (browser fallback)", () => {
  beforeEach(() => {
    localStorage.clear();
    // Ensure we're not in Tauri context
    delete ((window as unknown) as Record<string, unknown>)["__TAURI_INTERNALS__"];
  });

  it("returns null for missing key", async () => {
    expect(await storage.get("missing")).toBeNull();
  });

  it("sets and gets a value", async () => {
    await storage.set("token", "abc123");
    expect(await storage.get("token")).toBe("abc123");
  });

  it("removes a key", async () => {
    await storage.set("token", "abc123");
    await storage.remove("token");
    expect(await storage.get("token")).toBeNull();
  });

  it("clears all keys", async () => {
    await storage.set("a", "1");
    await storage.set("b", "2");
    await storage.clear();
    expect(await storage.get("a")).toBeNull();
    expect(await storage.get("b")).toBeNull();
  });
});
