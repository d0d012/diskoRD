import { api } from "../../lib/api";
import { useCallViewHost } from "../../hooks/useCallViewHost";
import { useGuildStore } from "../../stores/guildStore";
import { useVoiceStore } from "../../stores/voiceStore";

/**
 * Desktop: lets the current guild voice channel show in the separate call window. The
 * in-app voice panel is unchanged; the window is an extra view opened from the sidebar
 * "Voice Connected" bar or the voice control bar.
 */
export function VoiceCallViewHost() {
  const {
    activeVoiceChannelId, activeVoiceGuildId, liveKitToken, isMuted, isDeafened, isCameraOn, voiceWindowOpen,
  } = useVoiceStore();
  const channelName = useGuildStore((s) =>
    (s.channels[activeVoiceGuildId ?? ""] ?? []).find((c) => c.id === activeVoiceChannelId)?.name);

  useCallViewHost({
    kind: "guild",
    // Only once connected: the viewer endpoint requires being in the channel.
    sessionId: liveKitToken ? activeVoiceChannelId : null,
    title: channelName ? `#${channelName}` : "Voice",
    visible: voiceWindowOpen,
    isMuted,
    isDeafened,
    cameraOn: isCameraOn,
    fetchViewer: async (channelId) => (await api.post(`/channels/${channelId}/voice/viewer`)).data.data,
    onCommand: (command) => {
      const voice = useVoiceStore.getState();
      if (command.type === "mute") voice.setMuted(!voice.isMuted);
      else if (command.type === "deafen") voice.setDeafened(!voice.isDeafened);
      else if (command.type === "camera") voice.setCameraOn(!voice.isCameraOn);
      else if (command.type === "hangup") void voice.leaveVoice();
    },
    onClosed: () => useVoiceStore.getState().setVoiceWindowOpen(false),
  });

  return null;
}
