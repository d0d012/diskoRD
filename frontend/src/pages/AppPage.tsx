import { MainLayout } from "../components/layout/MainLayout";
import { useGuildStore } from "../stores/guildStore";

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
      <div className="w-40 h-40 opacity-20">
        <svg viewBox="0 0 197 197" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M168.35 40.67A157.4 157.4 0 0 0 127.3 28.5a.59.59 0 0 0-.63.3 109.6 109.6 0 0 0-4.84 9.93c-14.65-2.2-29.25-2.2-43.6 0A109.4 109.4 0 0 0 73.3 28.8a.61.61 0 0 0-.63-.3 157.04 157.04 0 0 0-38.84 12.06.55.55 0 0 0-.26.22C8.06 81.6 1.43 121.43 4.74 160.78a.65.65 0 0 0 .25.45c16.31 11.98 32.12 19.26 47.64 24.1a.62.62 0 0 0 .67-.22 112.3 112.3 0 0 0 9.74-15.86.6.6 0 0 0-.33-.83 103.6 103.6 0 0 1-14.88-7.09.61.61 0 0 1-.06-1.01c1-.75 2-1.53 2.95-2.32a.59.59 0 0 1 .62-.08c31.21 14.25 65.03 14.25 95.85 0a.59.59 0 0 1 .62.07c.96.79 1.96 1.58 2.96 2.33a.61.61 0 0 1-.05 1.01 97.7 97.7 0 0 1-14.9 7.07.6.6 0 0 0-.32.85 126.1 126.1 0 0 0 9.74 15.83.6.6 0 0 0 .67.23c15.58-4.84 31.39-12.12 47.7-24.1a.64.64 0 0 0 .25-.44c3.97-41.16-6.66-80.66-28.22-112.11a.5.5 0 0 0-.25-.22zM70.02 138.27c-9.4 0-17.14-8.63-17.14-19.22s7.59-19.22 17.14-19.22c9.62 0 17.29 8.71 17.13 19.22 0 10.59-7.59 19.22-17.13 19.22zm63.32 0c-9.4 0-17.14-8.63-17.14-19.22s7.59-19.22 17.14-19.22c9.62 0 17.29 8.71 17.13 19.22 0 10.59-7.59 19.22-17.13 19.22z"
            fill="white"
          />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-[var(--color-dc-header-primary)] text-2xl font-bold mb-2">
          No Text Channels
        </h2>
        <p className="text-[var(--color-dc-text-muted)] text-base max-w-xs">
          You find yourself in a strange place. You don't have access to any text channels, or there are none in this server.
        </p>
      </div>
    </div>
  );
}

function ChannelView({ channelId }: { channelId: string }) {
  const { channels, activeGuildId } = useGuildStore();
  const guildChannels = activeGuildId ? (channels[activeGuildId] ?? []) : [];
  const channel = guildChannels.find((c) => c.id === channelId);

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div
        className="h-12 px-4 flex items-center gap-2 flex-shrink-0 border-b shadow-sm"
        style={{ borderColor: "var(--color-dc-bg-floating)" }}
      >
        <span className="text-[var(--color-dc-text-muted)] text-xl leading-none">#</span>
        <span className="text-[var(--color-dc-header-primary)] font-semibold">
          {channel?.name ?? channelId}
        </span>
      </div>
      {/* Messages area — populated in Phase 3 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col items-start gap-1 mt-auto">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
            style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
          >
            <span className="text-[var(--color-dc-text-muted)] text-3xl">#</span>
          </div>
          <h2 className="text-[var(--color-dc-header-primary)] text-2xl font-bold">
            Welcome to #{channel?.name ?? channelId}!
          </h2>
          <p className="text-[var(--color-dc-text-muted)] text-base">
            This is the start of the #{channel?.name ?? channelId} channel.
          </p>
        </div>
      </div>
      {/* Message input */}
      <div className="px-4 pb-6 flex-shrink-0">
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg"
          style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }}
        >
          <button className="text-[var(--color-dc-interactive-normal)] hover:text-[var(--color-dc-interactive-hover)] flex-shrink-0">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.00098C6.486 2.00098 2 6.48698 2 12.001C2 17.515 6.486 22.001 12 22.001C17.514 22.001 22 17.515 22 12.001C22 6.48698 17.514 2.00098 12 2.00098ZM17 13.001H13V17.001H11V13.001H7V11.001H11V7.00098H13V11.001H17V13.001Z" />
            </svg>
          </button>
          <input
            type="text"
            placeholder={`Message #${channel?.name ?? channelId}`}
            className="flex-1 bg-transparent text-[var(--color-dc-text-normal)] placeholder:text-[var(--color-dc-text-muted)] outline-none text-base"
          />
          <button className="text-[var(--color-dc-interactive-normal)] hover:text-[var(--color-dc-interactive-hover)] flex-shrink-0">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM7 9.5C7 8.67157 7.67157 8 8.5 8C9.32843 8 10 8.67157 10 9.5C10 10.3284 9.32843 11 8.5 11C7.67157 11 7 10.3284 7 9.5ZM14 9.5C14 8.67157 14.6716 8 15.5 8C16.3284 8 17 8.67157 17 9.5C17 10.3284 16.3284 11 15.5 11C14.6716 11 14 10.3284 14 9.5ZM8.89443 14.5528C8.6655 14.0949 8.1414 13.8589 7.65367 14.0019C7.16594 14.145 6.87279 14.6523 7.00017 15.1443C7.43228 16.8167 9.0571 18 12.0002 18C14.9433 18 16.5681 16.8167 17.0002 15.1443C17.1276 14.6523 16.8345 14.145 16.3467 14.0019C15.859 13.8589 15.3349 14.0949 15.106 14.5528C14.8118 15.1411 13.8812 16 12.0002 16C10.1192 16 9.18864 15.1411 8.89443 14.5528Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppPage() {
  const { activeChannelId } = useGuildStore();

  return (
    <MainLayout>
      {activeChannelId ? <ChannelView channelId={activeChannelId} /> : <EmptyState />}
    </MainLayout>
  );
}
