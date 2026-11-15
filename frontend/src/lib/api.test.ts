import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

const store = new Map<string, string>();
vi.mock("./storage", () => ({
  storage: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    remove: vi.fn(async (k: string) => void store.delete(k)),
  },
}));

import { refreshSession, resolveMediaUrlAgainst, setSessionHandlers, SessionExpiredError } from "./api";

describe("resolveMediaUrlAgainst", () => {
  it("prefixes relative /uploads URLs with the origin of an absolute API base (desktop)", () => {
    expect(resolveMediaUrlAgainst("/uploads/board-assets/b/x.png", "https://diskord.example.com/api"))
      .toBe("https://diskord.example.com/uploads/board-assets/b/x.png");
  });
  it("leaves relative URLs alone for a same-origin API base (web)", () => {
    expect(resolveMediaUrlAgainst("/uploads/a/image.png", "/api")).toBe("/uploads/a/image.png");
  });
  it("passes absolute, blob and empty values through", () => {
    expect(resolveMediaUrlAgainst("http://localhost:8080/uploads/a.png", "https://x.example/api")).toBe("http://localhost:8080/uploads/a.png");
    expect(resolveMediaUrlAgainst("blob:http://tauri.localhost/1", "https://x.example/api")).toBe("blob:http://tauri.localhost/1");
    expect(resolveMediaUrlAgainst(null, "https://x.example/api")).toBeUndefined();
  });
});

const onRefreshed = vi.fn();
const onExpired = vi.fn();

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
  onRefreshed.mockClear();
  onExpired.mockClear();
  setSessionHandlers({ onRefreshed, onExpired });
  store.set("refresh_token", "r1");
});

describe("refreshSession", () => {
  it("persists the rotated refresh token", async () => {
    vi.spyOn(axios, "post").mockResolvedValue({
      data: { data: { accessToken: "a2", refreshToken: "r2", user: { id: "u" } } },
    });
    await expect(refreshSession()).resolves.toBe("a2");
    expect(store.get("refresh_token")).toBe("r2");
    expect(onRefreshed).toHaveBeenCalledOnce();
  });

  it("shares one request between concurrent callers", async () => {
    const post = vi.spyOn(axios, "post").mockResolvedValue({
      data: { data: { accessToken: "a2", refreshToken: "r2" } },
    });
    await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(post).toHaveBeenCalledOnce();
  });

  it("logs out on an explicit 401", async () => {
    vi.spyOn(axios, "post").mockRejectedValue({ response: { status: 401 } });
    await expect(refreshSession()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(onExpired).toHaveBeenCalledOnce();
    expect(store.has("refresh_token")).toBe(false);
  });

  it("keeps the session on a transient failure", async () => {
    vi.useFakeTimers();
    vi.spyOn(axios, "post")
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValue({ data: { data: { accessToken: "a2", refreshToken: "r2" } } });
    const p = refreshSession();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe("a2");
    expect(onExpired).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
