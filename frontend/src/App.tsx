import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AppPage } from "./pages/AppPage";
import { InvitePage } from "./pages/InvitePage";
import { useAuthStore } from "./stores/authStore";
import { useUpdater } from "./hooks/useUpdater";
import { useNoiseCancellation } from "./hooks/useNoiseCancellation";
import { useDeepLinks } from "./hooks/useDeepLinks";
import { installExternalLinkHandler } from "./lib/externalLinks";
import { useSettingsStore } from "./stores/settingsStore";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  const location = useLocation();
  return accessToken ? (
    <>{children}</>
  ) : (
    <Navigate to="/login" state={{ returnTo: location.pathname }} replace />
  );
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  return accessToken ? <Navigate to="/app" replace /> : <>{children}</>;
}

function UpdateToast({
  version,
  onRestart,
}: {
  version: string | null;
  onRestart: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        backgroundColor: "#5865f2",
        color: "#fff",
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        fontSize: 14,
      }}
    >
      <span>
        diskoRD {version ? `v${version}` : "update"} is ready
      </span>
      <button
        onClick={onRestart}
        style={{
          backgroundColor: "#fff",
          color: "#5865f2",
          border: "none",
          borderRadius: 4,
          padding: "4px 10px",
          fontWeight: 600,
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        Restart
      </button>
    </div>
  );
}

export function App() {
  const { initialize, isInitialized } = useAuthStore();
  const { updateReady, updateVersion, restartApp } = useUpdater();
  const { loadPersistedPreference } = useNoiseCancellation();
  useDeepLinks();

  useEffect(() => {
    initialize();
    loadPersistedPreference();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => installExternalLinkHandler(), []);
  useEffect(() => { void useSettingsStore.getState().load(); }, []);

  if (!isInitialized) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--color-dc-bg-primary, #313338)",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            border: "3px solid #5865f2",
            borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
          <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
          <Route
            path="/app"
            element={
              <PrivateRoute>
                <AppPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/invite/:code"
            element={
              <PrivateRoute>
                <InvitePage />
              </PrivateRoute>
            }
          />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
      {updateReady && (
        <UpdateToast version={updateVersion} onRestart={restartApp} />
      )}
    </>
  );
}
