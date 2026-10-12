import { isCallPanelHidden, useCallStore } from "../../stores/callStore";
import { useFriendStore } from "../../stores/friendStore";
import { useGuildStore } from "../../stores/guildStore";
import { useVoiceStore } from "../../stores/voiceStore";

/** Sidebar bar for an active DM call — the way back to a hidden call window. */
export function CallStatusBar() {
  const { state, call, endCall, setCallPanelHidden } = useCallStore();
  const hidden = useCallStore(isCallPanelHidden);
  const { isMuted, setMuted } = useVoiceStore();

  if (state !== "in-call" || !call) return null;

  function openConversation() {
    useGuildStore.getState().setActiveGuild(null);
    useFriendStore.getState().setActiveDM(call!.channelId);
  }

  const iconButton = "p-1 rounded transition-colors flex-shrink-0 hover:bg-[var(--color-dc-bg-modifier-hover)]";

  return (
    <div
      className="flex-shrink-0 px-2 py-2 border-t"
      style={{ borderColor: "var(--color-dc-bg-floating)", backgroundColor: "var(--color-dc-bg-tertiary)" }}
    >
      <div className="flex items-center gap-2 px-2 py-1 rounded-md" style={{ backgroundColor: "rgba(35,165,90,0.12)" }}>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: "var(--color-dc-online, #23a55a)" }} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate" style={{ color: "var(--color-dc-online, #23a55a)" }}>Call Connected</p>
          <button
            className="block max-w-full text-xs truncate hover:underline text-left"
            style={{ color: "var(--color-dc-text-muted)" }}
            onClick={openConversation}
            title={`Open your conversation with ${call.recipientName}`}
          >
            with {call.recipientName}
          </button>
        </div>
        <button
          onClick={() => setCallPanelHidden(!hidden)}
          title={hidden ? "Show call window" : "Hide call window"}
          aria-label={hidden ? "Show call window" : "Hide call window"}
          aria-pressed={!hidden}
          className={iconButton}
          style={{ color: hidden ? "var(--color-dc-interactive-normal)" : "var(--color-dc-interactive-active)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="14" rx="2" />
            <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button
          onClick={() => setMuted(!isMuted)}
          title={isMuted ? "Unmute" : "Mute"}
          aria-label={isMuted ? "Unmute" : "Mute"}
          className={iconButton}
          style={{ color: isMuted ? "var(--color-dc-red, #ed4245)" : "var(--color-dc-interactive-normal)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {isMuted ? (
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
            ) : (
              <path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V6zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z" />
            )}
          </svg>
        </button>
        <button
          onClick={() => endCall(call.channelId)}
          title="End call"
          aria-label="End call"
          className={iconButton}
          style={{ color: "var(--color-dc-red, #ed4245)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08A.99.99 0 0 1 0 12.37c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a1 1 0 0 1-.71.29c-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.985.985 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
