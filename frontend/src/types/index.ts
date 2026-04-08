export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data?: {
    items: T[];
    hasMore: boolean;
  };
  error?: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  status: "online" | "idle" | "dnd" | "offline";
  createdAt: string;
}

export interface Guild {
  id: string;
  name: string;
  iconUrl?: string;
  ownerId: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  guildId: string;
  name: string;
  type: "text" | "voice";
  position: number;
  createdAt: string;
}

export interface Message {
  id: string;
  channelId: string;
  guildId?: string;
  author: User;
  content: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  reactions?: { emoji: string; count: number; selfReacted: boolean }[];
  mentions?: string[];
  attachments?: string[]; // public image URLs
}

export interface GuildMember {
  guildId: string;
  user: User;
  role: "owner" | "admin" | "member";
  joinedAt: string;
}

export interface GuildRole {
  id: string;
  name: string;
  color: string;
  position: number;
  hoist: boolean;
  memberCount?: number;
}

export interface Member {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  role: string;
  roles: GuildRole[];
  joinedAt: string;
  status: string;
}
