import type { ReactNode } from "react";
import { ServerSidebar } from "./ServerSidebar";
import { ChannelSidebar } from "./ChannelSidebar";
import { MembersPanel } from "./MembersPanel";
import { FriendsSidebar } from "../../features/friend/FriendsSidebar";
import { useGuildStore } from "../../stores/guildStore";
import { useUnreadTitle } from "../../hooks/useUnreadTitle";
import { useOSBadge } from "../../hooks/useOSBadge";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  useUnreadTitle();
  useOSBadge();
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const isHome = activeGuildId === null;

  return (
    <div className="flex h-full w-full overflow-hidden bg-dc-bg-tertiary">
      <ServerSidebar />
      <div className="dc-workspace relative flex flex-1 min-w-0 overflow-hidden rounded-tl-lg">
        {isHome ? <FriendsSidebar /> : <ChannelSidebar />}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
          {children}
        </main>
        {!isHome && <MembersPanel />}
      </div>
    </div>
  );
}
