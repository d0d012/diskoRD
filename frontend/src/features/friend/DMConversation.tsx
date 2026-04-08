import { useFriendStore } from "../../stores/friendStore";
import { useCallStore } from "../../stores/callStore";
import { MessageList } from "../message/MessageList";
import { MessageInput } from "../message/MessageInput";
import { PresenceDot } from "../../components/ui/PresenceDot";
import { DMCallPanel } from "../call/DMCallPanel";
import { useGateway } from "../../hooks/useGateway";

export function DMConversation() {
  const { dms, activeDMId } = useFriendStore();
  const { sendTyping } = useGateway();
  const { state: callState, call, initiateCall } = useCallStore();

  const dm = dms.find((d) => d.id === activeDMId);
  if (!dm) return null;

  const inCallHere = (callState === "in-call" || callState === "calling") && call?.channelId === dm.id;
  const callDisabled = callState !== "idle";

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
      {/* Header */}
      <div className="h-12 px-4 flex items-center gap-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-dc-bg-floating)" }}>
        <div className="relative flex-shrink-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold"
            style={{
              backgroundColor: `hsl(${(dm.recipient.username.charCodeAt(0) * 37) % 360}, 55%, 45%)`,
            }}
          >
            {dm.recipient.username[0]?.toUpperCase()}
          </div>
          <PresenceDot status={dm.recipient.status} borderColor="var(--color-dc-bg-primary)" />
        </div>
        <span className="font-semibold flex-1" style={{ color: "var(--color-dc-header-primary)" }}>
          {dm.recipient.username}
        </span>

        {/* Call button */}
        {!inCallHere && (
          <button
            onClick={() => initiateCall(dm.id, dm.recipient.id, dm.recipient.username)}
            disabled={callDisabled}
            title="Start voice call"
            className="p-1.5 rounded transition-colors"
            style={{
              color: callDisabled ? "var(--color-dc-interactive-muted)" : "var(--color-dc-interactive-normal)",
              cursor: callDisabled ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => {
              if (!callDisabled) e.currentTarget.style.color = "var(--color-dc-interactive-hover)";
            }}
            onMouseLeave={(e) => {
              if (!callDisabled) e.currentTarget.style.color = "var(--color-dc-interactive-normal)";
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Compact call panel — shown above chat when in-call in this DM */}
      {inCallHere && <DMCallPanel />}

      <MessageList channelId={dm.id} channelName={dm.recipient.username} />

      <MessageInput
        channelId={dm.id}
        guildId=""
        channelName={dm.recipient.username}
        onTyping={sendTyping}
      />
    </div>
  );
}
