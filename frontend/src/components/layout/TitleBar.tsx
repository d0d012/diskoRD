import { getCurrentWindow } from "@tauri-apps/api/window";

const isTauri = "__TAURI_INTERNALS__" in window;

export function TitleBar() {
  if (!isTauri) return null;

  const win = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="flex items-center justify-between h-8 flex-shrink-0 select-none"
      style={{ backgroundColor: "var(--color-dc-bg-tertiary, #1e1f22)" }}
    >
      {/* Left: app name */}
      <span
        data-tauri-drag-region
        className="pl-3 text-xs font-semibold"
        style={{ color: "var(--color-dc-text-muted, #80848e)" }}
      >
        diskoRD
      </span>

      {/* Right: window controls */}
      <div className="flex h-full">
        {/* Minimize */}
        <button
          onClick={() => win.minimize()}
          className="w-11 h-full flex items-center justify-center transition-colors"
          style={{ color: "var(--color-dc-interactive-normal, #b5bac1)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          title="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>

        {/* Maximize */}
        <button
          onClick={() => win.toggleMaximize()}
          className="w-11 h-full flex items-center justify-center transition-colors"
          style={{ color: "var(--color-dc-interactive-normal, #b5bac1)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          title="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={() => win.close()}
          className="w-11 h-full flex items-center justify-center transition-colors"
          style={{ color: "var(--color-dc-interactive-normal, #b5bac1)" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#ed4245"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--color-dc-interactive-normal, #b5bac1)"; }}
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
