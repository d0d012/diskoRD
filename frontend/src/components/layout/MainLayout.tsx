import type { ReactNode } from "react";
import { ServerSidebar } from "./ServerSidebar";
import { ChannelSidebar } from "./ChannelSidebar";
import { MembersPanel } from "./MembersPanel";
import { FriendsSidebar } from "../../features/friend/FriendsSidebar";
import { useGuildStore } from "../../stores/guildStore";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const activeGuildId = useGuildStore((s) => s.activeGuildId);
  const isHome = activeGuildId === null;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ServerSidebar />
      {isHome ? <FriendsSidebar /> : <ChannelSidebar />}
      <main className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
        {children}
      </main>
      {!isHome && <MembersPanel />}
    </div>
  );
}
