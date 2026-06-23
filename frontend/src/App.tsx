import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AppPage } from "./pages/AppPage";
import { InvitePage } from "./pages/InvitePage";
import { useAuthStore } from "./stores/authStore";

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

export function App() {
  const { initialize, isInitialized } = useAuthStore();

  useEffect(() => {
    initialize();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  );
}
