import { useEffect } from "react";
import { useCallStore } from "../../stores/callStore";
import { startLoop, stopLoop } from "../../lib/sounds";

export function IncomingCallOverlay() {
  const { state, call, acceptCall, declineCall } = useCallStore();

  useEffect(() => {
    if (state !== "ringing") return;
    startLoop("call");
    return stopLoop;
  }, [state]);

  if (state !== "ringing" || !call) return null;

  const color = `hsl(${(call.recipientName.charCodeAt(0) * 37) % 360}, 55%, 45%)`;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="flex flex-col items-center gap-5 p-8 rounded-2xl shadow-2xl"
        style={{ backgroundColor: "var(--color-dc-bg-secondary)", minWidth: 280 }}
      >
        {/* Avatar */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-semibold select-none"
          style={{ backgroundColor: color }}
        >
          {call.recipientName[0]?.toUpperCase()}
        </div>

        <div className="text-center">
          <p className="text-base font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>
            {call.recipientName}
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--color-dc-text-muted)" }}>
            Incoming call…
          </p>
        </div>

        <div className="flex gap-6 mt-2">
          {/* Decline */}
          <button
            onClick={() => declineCall(call.channelId)}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
            title="Decline"
            style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
            </svg>
          </button>

          {/* Accept */}
          <button
            onClick={() => acceptCall(call.channelId)}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
            title="Accept"
            style={{ backgroundColor: "#23a55a" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
