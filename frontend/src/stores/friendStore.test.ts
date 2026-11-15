import { beforeEach, describe, expect, it } from "vitest";
import { useFriendStore, type DMChannel, type FriendUser } from "./friendStore";

function friend(id: string, status: FriendUser["status"] = "online"): FriendUser {
  return { id, username: id, status };
}

function dm(id: string, status: FriendUser["status"] = "idle"): DMChannel {
  return { id: `dm-${id}`, recipient: friend(id, status), createdAt: "2024-01-01T00:00:00Z" };
}

beforeEach(() => {
  useFriendStore.setState({
    friends: [friend("a", "online")],
    requests: [],
    dms: [dm("b", "idle")],
    activeDMId: null,
  });
});

describe("friendStore.updatePresence", () => {
  it("updates friends and dms when the status changes", () => {
    useFriendStore.getState().updatePresence("a", "dnd");
    expect(useFriendStore.getState().friends[0].status).toBe("dnd");

    useFriendStore.getState().updatePresence("b", "offline");
    expect(useFriendStore.getState().dms[0].recipient.status).toBe("offline");
  });

  it("keeps the previous state object when the status is unchanged or the user is unknown", () => {
    const before = useFriendStore.getState();
    useFriendStore.getState().updatePresence("a", "online");
    useFriendStore.getState().updatePresence("b", "idle");
    useFriendStore.getState().updatePresence("unknown", "dnd");
    expect(useFriendStore.getState()).toBe(before);
  });

  it("does not rebuild the collection that did not change", () => {
    const before = useFriendStore.getState();
    useFriendStore.getState().updatePresence("a", "dnd");
    expect(useFriendStore.getState().friends).not.toBe(before.friends);
    expect(useFriendStore.getState().dms).toBe(before.dms);
  });
});
