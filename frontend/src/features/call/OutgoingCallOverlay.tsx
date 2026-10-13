import { useEffect } from "react";
import { useCallStore } from "../../stores/callStore";
import { startLoop, stopLoop } from "../../lib/sounds";
import { useLiveUser } from "../../hooks/useLiveUser";
import { Avatar } from "../../components/ui/Avatar";
import { avatarColor } from "../../lib/avatar";

export function OutgoingCallOverlay() {
  const { state, call, cancelCall } = useCallStore();
  const live = useLiveUser(call?.recipientId, { id: call?.recipientId ?? "", username: call?.recipientName ?? "" });

  useEffect(() => {
    if (state !== "calling") return;
    startLoop("call", 0.3);
    return stopLoop;
  }, [state]);

  if (state !== "calling" || !call) return null;

  const color = avatarColor(call.recipientName);

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="flex flex-col items-center gap-5 p-8 rounded-2xl shadow-2xl"
        style={{ backgroundColor: "var(--color-dc-bg-secondary)", minWidth: 280 }}
      >
        {/* Pulsing avatar */}
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full animate-ping opacity-30"
            style={{ backgroundColor: color }}
          />
          <Avatar name={live.username ?? call.recipientName} src={live.avatarUrl} size={80} />
        </div>

        <div className="text-center">
          <p className="text-base font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>
            {call.recipientName}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--color-dc-text-muted)" }}>
            Calling…
          </p>
        </div>

        {/* Cancel */}
        <button
          onClick={() => cancelCall(call.channelId)}
          className="w-14 h-14 rounded-full flex items-center justify-center transition-opacity hover:opacity-80 mt-2"
          title="Cancel"
          style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
            <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
