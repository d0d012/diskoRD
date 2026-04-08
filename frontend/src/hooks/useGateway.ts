import { useEffect, useRef } from "react";
import { useAuthStore } from "../stores/authStore";
import { useMessageStore } from "../stores/messageStore";
import { useGuildStore } from "../stores/guildStore";
import { useFriendStore } from "../stores/friendStore";
import { usePresenceStore } from "../stores/presenceStore";
import { useVoiceStore } from "../stores/voiceStore";
import { useCallStore } from "../stores/callStore";
import { useNotificationStore } from "../stores/notificationStore";
import { useToastStore } from "../features/notification/NotificationToast";
import { playSound } from "../lib/sounds";
import type { Message } from "../types";

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ??
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/gateway`;

interface GatewayEvent {
  op: string;
  d?: unknown;
  s: number;
}

export function useGateway() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { addMessage, updateMessage, removeMessage, setTyping } = useMessageStore();
  const activeChannelId = useGuildStore((s) => s.activeChannelId);
  const activeDMId = useFriendStore((s) => s.activeDMId);
  const updatePresence = useFriendStore((s) => s.updatePresence);
  const addRequest = useFriendStore((s) => s.addRequest);
  const onFriendAccepted = useFriendStore((s) => s.onFriendAccepted);
  const onFriendDeclined = useFriendStore((s) => s.onFriendDeclined);
  const setPresenceStatus = usePresenceStore((s) => s.setStatus);
  const setPresenceStatuses = usePresenceStore((s) => s.setStatuses);
  const updateVoiceState = useVoiceStore((s) => s.updateVoiceState);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  // Refs so WS closure always sees the latest active channel without reconnecting
  const activeChannelIdRef = useRef(activeChannelId);
  const activeDMIdRef = useRef(activeDMId);
  useEffect(() => { activeChannelIdRef.current = activeChannelId; }, [activeChannelId]);
  useEffect(() => { activeDMIdRef.current = activeDMId; }, [activeDMId]);

  useEffect(() => {
    if (!accessToken || accessToken === "mock-token") return;

    let destroyed = false;

    function connect() {
      if (destroyed) return;

      const url = `${WS_URL}?token=${encodeURIComponent(accessToken!)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        // Connection established — HELLO event will set heartbeat interval
      };

      ws.onmessage = (evt) => {
        let event: GatewayEvent;
        try {
          event = JSON.parse(evt.data as string);
        } catch {
          return;
        }

        if (event.s > seqRef.current) seqRef.current = event.s;

        switch (event.op) {
          case "HELLO": {
            const d = event.d as { heartbeatInterval: number };
            const interval = d?.heartbeatInterval ?? 30000;
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
            heartbeatRef.current = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ op: "HEARTBEAT", s: seqRef.current }));
              }
            }, interval);
            break;
          }

          case "MESSAGE_CREATE": {
            const currentActive = activeChannelIdRef.current ?? activeDMIdRef.current;
            const msg = event.d as Message;
            const currentUser = useAuthStore.getState().user;
            addMessage(msg, currentActive, currentUser?.id);

            // ── Notification logic ─────────────────────────────────────────
            // Never notify for own messages or messages in the active channel
            if (msg.author?.id === currentUser?.id) break;
            if (msg.channelId === currentActive) break;

            const { status, isChannelMuted, isDmUserMuted } = useNotificationStore.getState();
            if (status === "dnd") break;

            const isMentioned = !!(currentUser?.id && (msg.mentions ?? []).includes(currentUser.id));
            const isDM = !msg.guildId;

            // Mute checks — mentions bypass all mutes
            if (!isMentioned) {
              if (isChannelMuted(msg.channelId)) break;
              if (isDM && isDmUserMuted(msg.author?.id ?? "")) break;
            }

            // Sound
            playSound(isMentioned ? "mention" : "notification");

            // In-app toast
            useToastStore.getState().push({
              id: msg.id,
              authorId: msg.author?.id ?? "",
              username: msg.author?.username ?? "Unknown",
              avatarUrl: msg.author?.avatarUrl,
              preview: msg.content,
              channelId: msg.channelId,
              guildId: msg.guildId,
              isMention: isMentioned,
            });

            // OS native notification when window is hidden, or always for mentions
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              if (document.visibilityState === "hidden" || isMentioned) {
                new Notification(msg.author?.username ?? "New message", {
                  body: msg.content.slice(0, 100),
                  silent: true, // we already played the sound ourselves
                });
              }
            }
            break;
          }

          case "MESSAGE_UPDATE":
            updateMessage(event.d as Message);
            break;

          case "MESSAGE_DELETE": {
            const d = event.d as { id: string; channelId: string };
            removeMessage(d.id, d.channelId);
            break;
          }

          case "REACTION_ADD": {
            const d = event.d as { messageId: string; channelId: string; emoji: string; count?: number; selfReacted?: boolean };
            // Depending on payload, we might not have count/selfReacted from backend events directly
            // For simplicity, add 1 optimistic reaction if not existing
            useMessageStore.getState().addReaction(d.messageId, d.channelId, { emoji: d.emoji, count: d.count || 1, selfReacted: d.selfReacted || false });
            break;
          }

          case "REACTION_REMOVE": {
            const d = event.d as { messageId: string; channelId: string; emoji: string; userId: string };
            useMessageStore.getState().removeReaction(d.messageId, d.channelId, d.emoji, d.userId);
            break;
          }

          case "TYPING_START": {
            const d = event.d as { channelId: string; userId: string; username: string };
            setTyping(d.channelId, { userId: d.userId, username: d.username, at: Date.now() });
            break;
          }

          case "READY": {
            const d = event.d as {
              presences: Record<string, string>;
              voiceStates: { userId: string; username: string; channelId: string; joined: boolean }[];
            };
            setPresenceStatuses(d.presences);
            for (const [userId, status] of Object.entries(d.presences)) {
              updatePresence(userId, status as "online" | "offline");
            }
            for (const vs of d.voiceStates) {
              updateVoiceState(vs.channelId, { userId: vs.userId, username: vs.username }, vs.joined);
            }
            break;
          }

          case "PRESENCE_UPDATE": {
            const d = event.d as { userId: string; status: "online" | "offline" };
            updatePresence(d.userId, d.status);
            setPresenceStatus(d.userId, d.status);
            break;
          }

          case "VOICE_STATE_UPDATE": {
            const d = event.d as { userId: string; username: string; channelId: string; joined: boolean };
            updateVoiceState(d.channelId, { userId: d.userId, username: d.username }, d.joined);

            const me = useAuthStore.getState().user;
            const { activeVoiceChannelId } = useVoiceStore.getState();
            const inThatChannel = activeVoiceChannelId === d.channelId;
            const isMe = d.userId === me?.id;

            if (d.joined) {
              // Joiner hears join, everyone already in the channel hears join
              if (isMe || inThatChannel) playSound("join");
            } else {
              if (isMe) {
                playSound("disconnect"); // the person leaving hears disconnect
              } else if (inThatChannel) {
                playSound("leave"); // remaining members hear leave
              }
            }
            break;
          }

          case "FRIEND_REQUEST": {
            addRequest(event.d as import("../stores/friendStore").FriendRequest);
            break;
          }

          case "FRIEND_ACCEPT": {
            const d = event.d as { friendshipId: string };
            onFriendAccepted(d.friendshipId);
            break;
          }

          case "FRIEND_DECLINE": {
            const d = event.d as { friendshipId: string };
            onFriendDeclined(d.friendshipId);
            break;
          }

          case "ROLE_CREATE":
          case "ROLE_UPDATE": {
            const d = event.d as import("../types").GuildRole & { guildId?: string };
            const guildId = d.guildId ?? useGuildStore.getState().activeGuildId;
            if (guildId) useGuildStore.getState().upsertRole(guildId, d);
            break;
          }

          case "ROLE_REORDER": {
            const d = event.d as { guildId: string; roles: import("../types").GuildRole[] };
            if (d.guildId) {
              useGuildStore.setState((s) => ({
                roles: { ...s.roles, [d.guildId]: d.roles },
              }));
            }
            break;
          }

          case "ROLE_DELETE": {
            const d = event.d as { guildId: string; roleId: string };
            useGuildStore.getState().removeRoleById(d.guildId, d.roleId);
            break;
          }

          case "MEMBER_ROLE_ADD":
          case "MEMBER_ROLE_REMOVE":
            // Member list will refetch on next open; no local member cache to update
            break;

          case "CALL_INVITE": {
            const d = event.d as { channelId: string; callerId: string; callerName: string };
            useCallStore.getState().onIncomingCall(d.channelId, d.callerId, d.callerName);
            playSound("notification");
            break;
          }

          case "CALL_ACCEPT": {
            const d = event.d as { channelId: string; token: string; url: string };
            useCallStore.getState().onCallAccepted(d.channelId, d.token, d.url);
            playSound("join");
            break;
          }

          case "CALL_DECLINE":
          case "CALL_END": {
            useCallStore.getState().onCallEnded();
            playSound("disconnect");
            break;
          }
        }
      };

      ws.onclose = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        if (!destroyed) {
          reconnectRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [accessToken]);

  function sendTyping(channelId: string, guildId: string) {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ op: "TYPING_START", d: { channelId, guildId } }));
    }
  }

  return { sendTyping };
}
