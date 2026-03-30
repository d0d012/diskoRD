import { useEffect, useRef } from "react";
import { useAuthStore } from "../stores/authStore";
import { useMessageStore } from "../stores/messageStore";
import { useGuildStore } from "../stores/guildStore";
import { useFriendStore } from "../stores/friendStore";
import { usePresenceStore } from "../stores/presenceStore";
import { useVoiceStore } from "../stores/voiceStore";
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
  const updatePresence = useFriendStore((s) => s.updatePresence);
  const setPresenceStatus = usePresenceStore((s) => s.setStatus);
  const updateVoiceState = useVoiceStore((s) => s.updateVoiceState);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

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

          case "MESSAGE_CREATE":
            addMessage(event.d as Message, activeChannelId);
            break;

          case "MESSAGE_UPDATE":
            updateMessage(event.d as Message);
            break;

          case "MESSAGE_DELETE": {
            const d = event.d as { id: string; channelId: string };
            removeMessage(d.id, d.channelId);
            break;
          }

          case "TYPING_START": {
            const d = event.d as { channelId: string; userId: string; username: string };
            setTyping(d.channelId, { userId: d.userId, username: d.username, at: Date.now() });
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
