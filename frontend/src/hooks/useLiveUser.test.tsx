import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLiveUser } from "./useLiveUser";
import { useUserStore } from "../stores/userStore";

beforeEach(() => {
  useUserStore.setState({ users: {} });
});

describe("useLiveUser", () => {
  it("prefers live store data over the fallback", () => {
    useUserStore.setState({ users: { u1: { id: "u1", username: "live", avatarUrl: "/a.png" } } });

    const { result } = renderHook(() =>
      useLiveUser("u1", { id: "u1", username: "fallback", avatarUrl: "/old.png" })
    );

    expect(result.current.username).toBe("live");
    expect(result.current.avatarUrl).toBe("/a.png");
  });

  it("returns the fallback when nothing is known about the user", () => {
    const { result } = renderHook(() => useLiveUser("ghost", { id: "ghost", username: "fallback" }));
    expect(result.current.username).toBe("fallback");
  });
});
