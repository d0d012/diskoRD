import { useGuildStore } from "../../stores/guildStore";
import type { Guild } from "../../types";

interface ServerIconProps {
  guild: Guild;
  active: boolean;
  onClick: () => void;
}

function ServerIcon({ guild, active, onClick }: ServerIconProps) {
  return (
    <div className="relative flex items-center mb-2 group" onClick={onClick}>
      {/* Active indicator pill */}
      <div
        className={`absolute -left-3 w-1 rounded-r-full bg-white transition-all duration-200 ${
          active ? "h-10" : "h-0 group-hover:h-5"
        }`}
      />
      <div
        className={`w-12 h-12 flex items-center justify-center cursor-pointer transition-all duration-200 overflow-hidden ${
          active
            ? "rounded-2xl bg-[var(--color-dc-brand)]"
            : "rounded-[50%] group-hover:rounded-2xl bg-[var(--color-dc-bg-secondary)]"
        }`}
      >
        {guild.iconUrl ? (
          <img src={guild.iconUrl} alt={guild.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-white text-sm font-semibold select-none">
            {guild.name
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-8 h-px bg-[var(--color-dc-divider)] mx-auto my-1" />;
}

function HomeButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <div className="relative flex items-center mb-2 group" onClick={onClick}>
      <div
        className={`absolute -left-3 w-1 rounded-r-full bg-white transition-all duration-200 ${
          active ? "h-10" : "h-0 group-hover:h-5"
        }`}
      />
      <div
        className={`w-12 h-12 flex items-center justify-center cursor-pointer transition-all duration-200 ${
          active
            ? "rounded-2xl bg-[var(--color-dc-brand)]"
            : "rounded-[50%] group-hover:rounded-2xl bg-[var(--color-dc-bg-secondary)] group-hover:bg-[var(--color-dc-brand)]"
        }`}
      >
        {/* Discord logo mark */}
        <svg width="28" height="20" viewBox="0 0 71 55" fill="white" aria-hidden="true">
          <path d="M60.105 4.898A58.55 58.55 0 0 0 45.653.415a.22.22 0 0 0-.233.11 40.784 40.784 0 0 0-1.8 3.697c-5.456-.817-10.886-.817-16.23 0-.485-1.164-1.201-2.587-1.828-3.697a.228.228 0 0 0-.233-.11 58.386 58.386 0 0 0-14.451 4.483.207.207 0 0 0-.095.082C1.578 18.73-.944 32.144.293 45.39a.244.244 0 0 0 .093.167c6.073 4.46 11.955 7.167 17.729 8.962a.23.23 0 0 0 .249-.082 42.08 42.08 0 0 0 3.627-5.9.225.225 0 0 0-.123-.312 38.772 38.772 0 0 1-5.539-2.64.228.228 0 0 1-.022-.378 31.17 31.17 0 0 0 1.1-.862.22.22 0 0 1 .23-.03c11.619 5.304 24.198 5.304 35.68 0a.219.219 0 0 1 .233.027 28.246 28.246 0 0 0 1.1.865.228.228 0 0 1-.02.378 36.384 36.384 0 0 1-5.54 2.637.227.227 0 0 0-.121.315 47.249 47.249 0 0 0 3.624 5.897.225.225 0 0 0 .249.084c5.801-1.794 11.684-4.502 17.757-8.961a.228.228 0 0 0 .092-.164c1.48-15.315-2.48-28.618-10.497-40.412a.18.18 0 0 0-.093-.084zm-36.38 32.427c-3.497 0-6.38-3.211-6.38-7.156 0-3.944 2.827-7.156 6.38-7.156 3.583 0 6.438 3.24 6.382 7.156 0 3.945-2.827 7.156-6.381 7.156zm23.593 0c-3.498 0-6.38-3.211-6.38-7.156 0-3.944 2.826-7.156 6.38-7.156 3.582 0 6.437 3.24 6.38 7.156 0 3.945-2.826 7.156-6.38 7.156z" />
        </svg>
      </div>
    </div>
  );
}

export function ServerSidebar() {
  const { guilds, activeGuildId, setActiveGuild } = useGuildStore();

  return (
    <nav
      className="w-[72px] flex-shrink-0 flex flex-col items-center pt-3 pb-2 overflow-y-auto overflow-x-hidden"
      style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
    >
      <HomeButton active={activeGuildId === null} onClick={() => {}} />
      <Divider />
      {guilds.map((guild) => (
        <ServerIcon
          key={guild.id}
          guild={guild}
          active={activeGuildId === guild.id}
          onClick={() => setActiveGuild(guild.id)}
        />
      ))}
      {/* Add server button */}
      <div className="group flex items-center mb-2">
        <div className="w-12 h-12 flex items-center justify-center cursor-pointer rounded-[50%] group-hover:rounded-2xl bg-[var(--color-dc-bg-secondary)] group-hover:bg-[var(--color-dc-online)] transition-all duration-200">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-label="Add a Server">
            <path d="M9 1v16M1 9h16" stroke="#23a559" strokeWidth="2.5" strokeLinecap="round" className="group-hover:stroke-white" />
          </svg>
        </div>
      </div>
    </nav>
  );
}
