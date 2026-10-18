import { useEffect } from "react";
import { MainLayout } from "../components/layout/MainLayout";
import { TitleBar } from "../components/layout/TitleBar";
import { useGuildStore } from "../stores/guildStore";
import { useFriendStore } from "../stores/friendStore";
import { sendGatewayTyping, useGateway } from "../hooks/useGateway";
import { useVoice } from "../hooks/useVoice";
import { MessageList } from "../features/message/MessageList";
import { MessageInput } from "../features/message/MessageInput";
import { FriendsPage } from "../features/friend/FriendsPage";
import { DMConversation } from "../features/friend/DMConversation";
import { VoicePanel } from "../features/voice/VoicePanel";
import { GlobalVoiceAudio } from "../features/voice/GlobalVoiceAudio";
import { NotificationToastContainer } from "../features/notification/NotificationToast";
import { IncomingCallOverlay } from "../features/call/IncomingCallOverlay";
import { ShowcaseMuseumHost } from "../features/pixelart/museum/ShowcaseMuseum";
import { OutgoingCallOverlay } from "../features/call/OutgoingCallOverlay";
import { DMCallPanel } from "../features/call/DMCallPanel";
import { VoiceCallViewHost } from "../features/voice/VoiceCallViewHost";

function EmptyState() {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-4"
      style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
    >
      <div className="w-40 h-40 opacity-20">
        <svg viewBox="0 0 197 197" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M168.35 40.67A157.4 157.4 0 0 0 127.3 28.5a.59.59 0 0 0-.63.3 109.6 109.6 0 0 0-4.84 9.93c-14.65-2.2-29.25-2.2-43.6 0A109.4 109.4 0 0 0 73.3 28.8a.61.61 0 0 0-.63-.3 157.04 157.04 0 0 0-38.84 12.06.55.55 0 0 0-.26.22C8.06 81.6 1.43 121.43 4.74 160.78a.65.65 0 0 0 .25.45c16.31 11.98 32.12 19.26 47.64 24.1a.62.62 0 0 0 .67-.22 112.3 112.3 0 0 0 9.74-15.86.6.6 0 0 0-.33-.83 103.6 103.6 0 0 1-14.88-7.09.61.61 0 0 1-.06-1.01c1-.75 2-1.53 2.95-2.32a.59.59 0 0 1 .62-.08c31.21 14.25 65.03 14.25 95.85 0a.59.59 0 0 1 .62.07c.96.79 1.96 1.58 2.96 2.33a.61.61 0 0 1-.05 1.01 97.7 97.7 0 0 1-14.9 7.07.6.6 0 0 0-.32.85 126.1 126.1 0 0 0 9.74 15.83.6.6 0 0 0 .67.23c15.58-4.84 31.39-12.12 47.7-24.1a.64.64 0 0 0 .25-.44c3.97-41.16-6.66-80.66-28.22-112.11a.5.5 0 0 0-.25-.22zM70.02 138.27c-9.4 0-17.14-8.63-17.14-19.22s7.59-19.22 17.14-19.22c9.62 0 17.29 8.71 17.13 19.22 0 10.59-7.59 19.22-17.13 19.22zm63.32 0c-9.4 0-17.14-8.63-17.14-19.22s7.59-19.22 17.14-19.22c9.62 0 17.29 8.71 17.13 19.22 0 10.59-7.59 19.22-17.13 19.22z"
            fill="white"
          />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2" style={{ color: "var(--color-dc-header-primary)" }}>
          No Text Channels
        </h2>
        <p className="text-base max-w-xs" style={{ color: "var(--color-dc-text-muted)" }}>
          You find yourself in a strange place. You don't have access to any text channels, or there
          are none in this server.
        </p>
      </div>
    </div>
  );
}

function ChannelView({ channelId }: { channelId: string }) {
  const { channels, activeGuildId } = useGuildStore();
  const guildChannels = activeGuildId ? (channels[activeGuildId] ?? []) : [];
  const channel = guildChannels.find((c) => c.id === channelId);
  const channelName = channel?.name ?? channelId;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
      {/* Channel header */}
      <div
        className="h-12 px-4 flex items-center gap-2 flex-shrink-0 border-b shadow-sm"
        style={{
          borderColor: "var(--color-dc-bg-floating)",
          backgroundColor: "var(--color-dc-bg-primary)",
        }}
      >
        <span className="text-xl leading-none font-bold" style={{ color: "var(--color-dc-text-muted)" }}>
          #
        </span>
        <span className="font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>
          {channelName}
        </span>
      </div>

      <MessageList channelId={channelId} channelName={channelName} />

      <MessageInput
        channelId={channelId}
        guildId={activeGuildId ?? ""}
        channelName={channelName}
        onTyping={sendGatewayTyping}
      />
    </div>
  );
}

export function AppPage() {
  const { activeChannelId, activeGuildId, channels, fetchGuilds } = useGuildStore();
  const { activeDMId } = useFriendStore();
  const { participants, connectionState } = useVoice();

  // Connect to WS gateway (no-op for mock accounts)
  useGateway();

  useEffect(() => {
    fetchGuilds();
  }, []);

  // Ask for notification permission on the first click or key press: WebKit (the macOS
  // app and Safari) rejects permission prompts that aren't triggered by a user gesture.
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    const events = ["pointerdown", "keydown"] as const;
    function ask() {
      events.forEach((e) => document.removeEventListener(e, ask, true));
      Notification.requestPermission().catch(() => {});
    }
    events.forEach((e) => document.addEventListener(e, ask, true));
    return () => events.forEach((e) => document.removeEventListener(e, ask, true));
  }, []);

  const isHome = activeGuildId === null;

  // Determine if active channel is a voice channel
  const guildChannels = activeGuildId ? (channels[activeGuildId] ?? []) : [];
  const activeChannel = guildChannels.find((c) => c.id === activeChannelId);
  const isVoiceChannel = activeChannel?.type === "voice";

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      <GlobalVoiceAudio participants={participants} />
      <NotificationToastContainer />
      <IncomingCallOverlay />
      <ShowcaseMuseumHost />
      <OutgoingCallOverlay />
      <DMCallPanel />
      <VoiceCallViewHost />
      <TitleBar />
      <div className="flex-1 overflow-hidden">
        <MainLayout>
          {isHome
            ? activeDMId
              ? <DMConversation />
              : <FriendsPage />
            : activeChannelId
              ? isVoiceChannel
                ? <VoicePanel participants={participants} connectionState={connectionState} />
                : <ChannelView channelId={activeChannelId} />
              : <EmptyState />
          }
        </MainLayout>
      </div>
    </div>
  );
}
