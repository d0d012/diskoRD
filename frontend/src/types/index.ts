import type { PixelArtDoc } from "../features/pixelart/lib/doc";
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

/** A status other users can see. `invisible` is never visible. */
export type PresenceStatus = "online" | "idle" | "dnd" | "offline";

/** The status a user can choose for themself. */
export type PreferredStatus = "online" | "idle" | "dnd" | "invisible";

/** The publicly shared profile fields, as carried by USER_UPDATE. */
export interface PublicUser {
  id: string;
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  bannerColor?: string | null;
}

export interface User extends PublicUser {
  email?: string;
  /** Legacy field; presence comes from the presence store, not this. */
  status: PresenceStatus;
  /** Only present on the authenticated user's own payload. */
  preferredStatus?: PreferredStatus;
  createdAt: string;
}

export interface Guild {
  id: string;
  name: string;
  iconUrl?: string | null;
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
  decorations?: Decoration[];
}

/** A pixel art piece pinned behind a message (see tasks/features/pixel-art.md). */
export interface Decoration {
  id: string;
  messageId: string;
  authorId: string | null;
  doc: PixelArtDoc;
  /** Horizontal center, % of the row width (0-100). */
  x: number;
  /** Top offset in px below the row top (0-64). */
  y: number;
  /** Display size in px. */
  size: number;
  /** Opacity in percent (10-100). */
  opacity: number;
  createdAt: string;
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
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  bannerColor?: string | null;
  role: string;
  roles: GuildRole[];
  joinedAt: string;
  createdAt?: string;
  status: PresenceStatus;
}

/** A saved piece in a user's pixel art gallery. */
export interface PixelArtPiece {
  id: string;
  ownerId: string;
  title: string;
  doc: PixelArtDoc;
  /** 0-14 when shown on the profile, null otherwise. */
  showcasePosition: number | null;
  remixOf: string | null;
  remixAuthor: { id: string; username: string; displayName?: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

/** A gallery piece placed on its owner's profile card. */
export interface ProfileBuddy {
  artId: string;
  /** Left edge in % of the card width. */
  x: number;
  /** Px from the card top. */
  y: number;
  height: number;
  flip: boolean;
  /** Drawn over the card's content boxes instead of behind them. */
  front: boolean;
}

/** A profile banner: a built-in scene id or the user's own banner-sized drawing. */
export interface ProfileBannerArt {
  builtin?: string;
  doc?: PixelArtDoc;
}

export interface PixelProfile {
  showcase: PixelArtPiece[];
  buddies: (ProfileBuddy & { doc: PixelArtDoc })[];
  /** null keeps the plain color banner. */
  banner: ProfileBannerArt | null;
}

