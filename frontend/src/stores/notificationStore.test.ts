import { describe, it, expect, beforeEach, vi } from "vitest";

const put = vi.fn();
vi.mock("../lib/api", () => ({ api: { put: (...a: unknown[]) => put(...a) } }));

import { useNotificationStore } from "./notificationStore";

beforeEach(() => {
  put.mockReset();
  useNotificationStore.setState({ status: "online" });
});

describe("notificationStore.setStatus", () => {
  it("persists the status to the server", async () => {
    put.mockResolvedValueOnce({ data: { data: { status: "dnd" } } });

    await useNotificationStore.getState().setStatus("dnd");

    expect(put).toHaveBeenCalledWith("/users/me/presence", { status: "dnd" });
    expect(useNotificationStore.getState().status).toBe("dnd");
  });

  it("reverts the optimistic change when the request fails", async () => {
    put.mockRejectedValueOnce(new Error("network"));

    await expect(useNotificationStore.getState().setStatus("invisible")).rejects.toBeTruthy();

    expect(useNotificationStore.getState().status).toBe("online");
  });

  it("does not overwrite a newer server status when an older request fails", async () => {
    let reject!: (e: unknown) => void;
    put.mockReturnValueOnce(new Promise((_, rej) => { reject = rej; }));

    const pending = useNotificationStore.getState().setStatus("dnd");
    // The server pushes the authoritative status while the write is in flight.
    useNotificationStore.getState().syncStatus("invisible");

    reject(new Error("network"));
    await expect(pending).rejects.toBeTruthy();

    expect(useNotificationStore.getState().status).toBe("invisible");
  });

  it("surfaces a status error when the request fails", async () => {
    put.mockRejectedValueOnce(new Error("network"));

    await expect(useNotificationStore.getState().setStatus("dnd")).rejects.toBeTruthy();

    expect(useNotificationStore.getState().statusError).toBeTruthy();
  });

  it("clears the status error after a successful change", async () => {
    useNotificationStore.setState({ statusError: "boom" });
    put.mockResolvedValueOnce({});

    await useNotificationStore.getState().setStatus("online");

    expect(useNotificationStore.getState().statusError).toBeNull();
  });

  it("does not let a stale success clear a newer failure toast", async () => {
    let resolveA!: (v: unknown) => void;
    put.mockReturnValueOnce(new Promise((res) => { resolveA = res; }));
    const first = useNotificationStore.getState().setStatus("dnd");

    put.mockRejectedValueOnce(new Error("network"));
    await expect(useNotificationStore.getState().setStatus("invisible")).rejects.toBeTruthy();
    expect(useNotificationStore.getState().statusError).toBeTruthy();

    resolveA({});
    await first;

    expect(useNotificationStore.getState().statusError).toBeTruthy();
  });
});
