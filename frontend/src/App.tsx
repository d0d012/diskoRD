import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { AppPage } from "./pages/AppPage";
import { useAuthStore } from "./stores/authStore";

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  return accessToken ? <>{children}</> : <Navigate to="/login" replace />;
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  return accessToken ? <Navigate to="/app" replace /> : <>{children}</>;
}

export function App() {
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
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
