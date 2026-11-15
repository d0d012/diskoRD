import { beforeEach, describe, expect, it } from "vitest";
import { usePresenceStore } from "./presenceStore";

beforeEach(() => {
  usePresenceStore.setState({ statuses: { u1: "online" }, guildAudience: new Set() });
});

describe("presenceStore", () => {
  it("setStatus updates a changed status", () => {
    usePresenceStore.getState().setStatus("u1", "dnd");
    expect(usePresenceStore.getState().statuses.u1).toBe("dnd");
  });

  it("setStatus keeps the previous statuses object when the status is unchanged", () => {
    const before = usePresenceStore.getState().statuses;
    usePresenceStore.getState().setStatus("u1", "online");
    expect(usePresenceStore.getState().statuses).toBe(before);
  });

  it("setStatuses merges new statuses", () => {
    usePresenceStore.getState().setStatuses({ u1: "idle", u2: "offline" });
    expect(usePresenceStore.getState().statuses).toEqual({ u1: "idle", u2: "offline" });
  });

  it("setStatuses keeps the previous object when every status is already equal", () => {
    const before = usePresenceStore.getState().statuses;
    usePresenceStore.getState().setStatuses({ u1: "online" });
    expect(usePresenceStore.getState().statuses).toBe(before);
  });
});
