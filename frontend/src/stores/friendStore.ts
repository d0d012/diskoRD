import { create } from "zustand";
import { api } from "../lib/api";
import { useUserStore } from "./userStore";
import type { PresenceStatus } from "../types";

export interface FriendUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  bannerColor?: string | null;
  status: PresenceStatus;
}

export interface FriendRequest {
  id: string; // friendship ID
  direction: "incoming" | "outgoing";
  user: FriendUser;
  createdAt: string;
}

export interface DMChannel {
  id: string;
  recipient: FriendUser;
  createdAt: string;
}

interface FriendStore {
  friends: FriendUser[];
  requests: FriendRequest[];
  dms: DMChannel[];
  activeDMId: string | null;

  fetchFriends: () => Promise<void>;
  fetchRequests: () => Promise<void>;
  fetchDMs: () => Promise<void>;
  sendRequest: (userId: string) => Promise<void>;
  acceptRequest: (friendshipId: string) => Promise<void>;
  declineRequest: (friendshipId: string) => Promise<void>;
  removeFriend: (friendshipId: string) => Promise<void>;
  openDM: (userId: string) => Promise<DMChannel>;
  setActiveDM: (dmId: string | null) => void;
  updatePresence: (userId: string, status: PresenceStatus) => void;
  // Gateway-driven updates
  addRequest: (req: FriendRequest) => void;
  onFriendAccepted: (friendshipId: string) => void;
  onFriendDeclined: (friendshipId: string) => void;
  onFriendRemoved: (userId?: string) => void;
}

export const useFriendStore = create<FriendStore>((set, get) => ({
  friends: [],
  requests: [],
  dms: [],
  activeDMId: null,

  fetchFriends: async () => {
    const { data } = await api.get("/users/me/friends");
    const friends: FriendUser[] = data.data ?? [];
    useUserStore.getState().upsertMany(friends);
    set({ friends });
  },

  fetchRequests: async () => {
    const { data } = await api.get("/users/me/friend-requests");
    const requests: FriendRequest[] = data.data ?? [];
    useUserStore.getState().upsertMany(requests.map((r) => r.user));
    set({ requests });
  },

  fetchDMs: async () => {
    const { data } = await api.get("/users/me/dms");
    const dms: DMChannel[] = data.data ?? [];
    useUserStore.getState().upsertMany(dms.map((d) => d.recipient));
    set({ dms });
  },

  sendRequest: async (userId) => {
    await api.post(`/users/${userId}/friend-request`);
    get().fetchRequests();
  },

  acceptRequest: async (friendshipId) => {
    await api.post(`/friend-requests/${friendshipId}/accept`);
    await Promise.all([get().fetchFriends(), get().fetchRequests()]);
  },

  declineRequest: async (friendshipId) => {
    await api.post(`/friend-requests/${friendshipId}/decline`);
    get().fetchRequests();
  },

  removeFriend: async (friendshipId) => {
    await api.delete(`/friends/${friendshipId}`);
    get().fetchFriends();
  },

  openDM: async (userId) => {
    const { data } = await api.post(`/dms/${userId}`);
    const dm: DMChannel = data.data;
    set((s) => {
      const exists = s.dms.find((d) => d.id === dm.id);
      return {
        dms: exists ? s.dms : [dm, ...s.dms],
        activeDMId: dm.id,
      };
    });
    return dm;
  },

  setActiveDM: (dmId) => set({ activeDMId: dmId }),

  updatePresence: (userId, status) => {
    set((s) => ({
      friends: s.friends.map((f) =>
        f.id === userId ? { ...f, status } : f
      ),
      dms: s.dms.map((d) =>
        d.recipient.id === userId
          ? { ...d, recipient: { ...d.recipient, status } }
          : d
      ),
    }));
  },

  addRequest: (req) => {
    set((s) => {
      if (s.requests.some((r) => r.id === req.id)) return s;
      return { requests: [req, ...s.requests] };
    });
  },

  onFriendAccepted: (friendshipId) => {
    // Remove from pending requests and re-fetch friends list
    set((s) => ({
      requests: s.requests.filter((r) => r.id !== friendshipId),
    }));
    get().fetchFriends();
  },

  onFriendDeclined: (friendshipId) => {
    set((s) => ({
      requests: s.requests.filter((r) => r.id !== friendshipId),
    }));
  },

  onFriendRemoved: (userId) => {
    if (!userId) {
      get().fetchFriends();
      return;
    }
    set((s) => ({
      friends: s.friends.filter((f) => f.id !== userId),
    }));
  },
}));
