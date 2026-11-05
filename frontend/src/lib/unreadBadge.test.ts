import { describe, expect, it } from "vitest";
import { formatBadge, selectUnreadBadge } from "./unreadBadge";

describe("unread badge selector", () => {
  it("excludes active DMs, muted DM channels/users and muted guild mentions", () => {
    expect(selectUnreadBadge({
      dms: ["active", "muted", "user", "dm"].map((id) => ({ id, recipient: { id } })),
      activeDMId: "active",
      unreadCounts: { active: 10, muted: 20, user: 30, dm: 4, guild: 100 },
      mentionCounts: { guild: 3, silent: 9, dm: 4, unknown: 10 },
      channelGuilds: { guild: "g", silent: "g" },
      mutedChannels: new Set(["muted", "silent"]),
      mutedDmUsers: new Set(["user"]),
    })).toEqual({ dmUnread: 4, osTotal: 7 });
  });
  it("handles missing counters", () => {
    expect(selectUnreadBadge({ dms: [{ id: "dm", recipient: { id: "u" } }], activeDMId: null,
      unreadCounts: {}, mentionCounts: {}, channelGuilds: {}, mutedChannels: new Set(), mutedDmUsers: new Set(),
    })).toEqual({ dmUnread: 0, osTotal: 0 });
  });
  it.each([[0, ""], [1, "1"], [9, "9"], [99, "99"], [100, "99+"], [500, "99+"]] as const)("formats %s", (n, text) => {
    expect(formatBadge(n)).toBe(text);
  });
});
