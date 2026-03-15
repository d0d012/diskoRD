import type { ReactNode } from "react";
import { ServerSidebar } from "./ServerSidebar";
import { ChannelSidebar } from "./ChannelSidebar";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <ServerSidebar />
      <ChannelSidebar />
      <main className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
        {children}
      </main>
    </div>
  );
}
