import { useFriendStore } from "../../stores/friendStore";
import { useCallStore } from "../../stores/callStore";
import { MessageList } from "../message/MessageList";
import { MessageInput } from "../message/MessageInput";
import { Avatar } from "../../components/ui/Avatar";
import { statusLabel } from "../../lib/avatar";
import { sendGatewayTyping } from "../../hooks/useGateway";

function PhoneIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
    </svg>
  );
}

export function DMConversation() {
  const { dms, activeDMId } = useFriendStore();
  const { state: callState, call, initiateCall, setCallPanelHidden } = useCallStore();

  const dm = dms.find((d) => d.id === activeDMId);
  if (!dm) return null;

  const { username, status } = dm.recipient;
  const callHere = callState !== "idle" && call?.channelId === dm.id;
  const callDisabled = callState !== "idle";
  const startCall = () => initiateCall(dm.id, dm.recipient.id, username);
  const callTitle = callHere ? "Call in progress" : callDisabled ? "You're already in a call" : `Start a voice call with ${username}`;

  const intro = (
    <div className="px-4 pt-14 pb-4">
      <Avatar name={username} size={80} />
      <h2 className="text-3xl font-bold mt-3" style={{ color: "var(--color-dc-header-primary)" }}>
        {username}
      </h2>
      <p className="text-sm mt-2" style={{ color: "var(--color-dc-text-muted)" }}>
        This is the beginning of your direct message history with{" "}
        <span className="font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>@{username}</span>.
      </p>
      <button
        onClick={startCall}
        disabled={callDisabled}
        title={callTitle}
        className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium text-white transition-[filter] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100"
        style={{ backgroundColor: "var(--color-dc-green, #248046)" }}
      >
        <PhoneIcon size={16} />
        Voice Call
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
      {/* Header */}
      <div
        className="h-12 px-4 flex items-center gap-3 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-dc-bg-floating)", boxShadow: "0 1px 0 rgba(0,0,0,0.2)" }}
      >
        <Avatar name={username} size={24} status={status} ringColor="var(--color-dc-bg-primary)" />
        <span className="font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>
          {username}
        </span>
        <span className="text-xs flex-shrink-0" style={{ color: "var(--color-dc-text-muted)" }}>
          {statusLabel(status)}
        </span>

        <div className="flex-1" />

        {callHere ? (
          <button
            onClick={() => setCallPanelHidden(false)}
            disabled={callState !== "in-call"}
            title={callState === "in-call" ? "Show call window" : undefined}
            className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-[filter] enabled:hover:brightness-125 disabled:cursor-default"
            style={{ backgroundColor: "rgba(35,165,90,0.15)", color: "var(--color-dc-online, #23a55a)" }}
          >
            <PhoneIcon size={14} />
            {callState === "in-call" ? "In call" : "Calling…"}
          </button>
        ) : (
          <button
            onClick={startCall}
            disabled={callDisabled}
            title={callTitle}
            aria-label={callTitle}
            className="p-1.5 rounded-md transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            style={{ color: "var(--color-dc-interactive-normal)" }}
          >
            <PhoneIcon />
          </button>
        )}
      </div>

      <MessageList channelId={dm.id} channelName={username} intro={intro} />

      <MessageInput
        channelId={dm.id}
        guildId=""
        channelName={username}
        placeholder={`Message @${username}`}
        onTyping={sendGatewayTyping}
      />
    </div>
  );
}
