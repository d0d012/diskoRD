import { useFriendStore } from "../../stores/friendStore";
import { MessageList } from "../message/MessageList";
import { MessageInput } from "../message/MessageInput";
import { PresenceDot } from "../../components/ui/PresenceDot";
import { useGateway } from "../../hooks/useGateway";

export function DMConversation() {
  const { dms, activeDMId } = useFriendStore();
  const { sendTyping } = useGateway();

  const dm = dms.find((d) => d.id === activeDMId);
  if (!dm) return null;

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
        <span className="font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>
          {dm.recipient.username}
        </span>
      </div>

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
