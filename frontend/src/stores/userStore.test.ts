import { describe, it, expect, beforeEach } from "vitest";
import { useUserStore } from "./userStore";

beforeEach(() => {
  useUserStore.setState({ users: {} });
});

describe("userStore", () => {
  it("merges partial upserts for the same user", () => {
    useUserStore.getState().upsertUser({ id: "u1", username: "alice" });
    useUserStore.getState().upsertUser({ id: "u1", avatarUrl: "/uploads/avatars/u1/a.png" });

    expect(useUserStore.getState().users.u1).toEqual({
      id: "u1",
      username: "alice",
      avatarUrl: "/uploads/avatars/u1/a.png",
    });
  });

  it("upsertMany merges a list and ignores entries without an id", () => {
    useUserStore.getState().upsertMany([
      { id: "u1", username: "alice" },
      { id: "u2", username: "bob" },
      { id: "", username: "broken" },
    ]);

    expect(Object.keys(useUserStore.getState().users)).toEqual(["u1", "u2"]);
  });
});
