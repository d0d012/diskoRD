import { useState, useRef } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

interface FieldError {
  email?: string;
  password?: string;
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldError>({});
  const [shaking, setShaking] = useState(false);
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const formRef = useRef<HTMLDivElement>(null);
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? "/app";

  function triggerShake() {
    setShaking(true);
    setTimeout(() => setShaking(false), 400);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    const newErrors: FieldError = {};
    if (!email.trim()) newErrors.email = "This field is required.";
    if (!password) newErrors.password = "This field is required.";
    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      triggerShake();
      return;
    }

    try {
      await login(email.trim(), password);
      navigate(returnTo);
    } catch {
      setErrors({ password: "Invalid email or password." });
      triggerShake();
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
    >
      <div
        ref={formRef}
        className={`flex rounded-md shadow-2xl overflow-hidden w-full max-w-[784px] mx-4 ${shaking ? "shake" : ""}`}
        style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
      >
        {/* Form panel */}
        <div className="flex-1 px-8 py-10 flex flex-col">
          <div className="text-center mb-5">
            <h1 className="text-[var(--color-dc-header-primary)] text-2xl font-bold mb-2">
              Welcome back!
            </h1>
            <p style={{ color: "var(--color-dc-header-secondary)" }} className="text-base">
              We're so excited to see you again!
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email field */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-wide" style={{ color: errors.email ? "var(--color-dc-red)" : "var(--color-dc-header-secondary)" }}>
                {errors.email ? (
                  <span>Email or Phone Number <span className="font-normal normal-case italic">- {errors.email}</span></span>
                ) : (
                  <span>Email or Phone Number <span style={{ color: "var(--color-dc-red)" }}>*</span></span>
                )}
              </label>
              <input
                type="text"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: undefined })); }}
                className="px-2.5 py-2 rounded text-base outline-none focus:ring-2"
                style={{
                  backgroundColor: "var(--color-dc-bg-tertiary)",
                  color: "var(--color-dc-text-normal)",
                  border: errors.email ? "1px solid var(--color-dc-red)" : "none",
                  // @ts-expect-error css var
                  "--tw-ring-color": "var(--color-dc-brand)",
                }}
              />
            </div>

            {/* Password field */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-wide flex items-center justify-between" style={{ color: errors.password ? "var(--color-dc-red)" : "var(--color-dc-header-secondary)" }}>
                <span>
                  {errors.password ? (
                    <span>Password <span className="font-normal normal-case italic">- {errors.password}</span></span>
                  ) : (
                    <span>Password <span style={{ color: "var(--color-dc-red)" }}>*</span></span>
                  )}
                </span>
                <a href="#" className="text-xs font-normal normal-case" style={{ color: "var(--color-dc-text-link)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                >
                  Forgot your password?
                </a>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: undefined })); }}
                className="px-2.5 py-2 rounded text-base outline-none focus:ring-2"
                style={{
                  backgroundColor: "var(--color-dc-bg-tertiary)",
                  color: "var(--color-dc-text-normal)",
                  border: errors.password ? "1px solid var(--color-dc-red)" : "none",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded text-white font-medium text-base mt-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer select-none"
              style={{ backgroundColor: "var(--color-dc-brand)", borderRadius: "3px" }}
              onMouseEnter={(e) => { if (!isLoading) (e.currentTarget.style.backgroundColor = "var(--color-dc-brand-560)"); }}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-brand)")}
            >
              {isLoading ? "Logging in..." : "Log In"}
            </button>

            <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>
              Need an account?{" "}
              <Link to="/register" style={{ color: "var(--color-dc-text-link)" }}
                className="hover:underline">
                Register
              </Link>
            </p>
          </form>
        </div>

        {/* QR Code panel */}
        <div
          className="hidden md:flex flex-col items-center justify-center px-10 py-10 gap-5 w-64 flex-shrink-0"
          style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
        >
          {/* QR code placeholder */}
          <div
            className="w-40 h-40 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "white", padding: "12px" }}
          >
            <div className="w-full h-full grid grid-cols-7 grid-rows-7 gap-0.5">
              {Array.from({ length: 49 }).map((_, i) => {
                const row = Math.floor(i / 7);
                const col = i % 7;
                const isCorner =
                  (row < 3 && col < 3) ||
                  (row < 3 && col > 3) ||
                  (row > 3 && col < 3);
                const isBorder =
                  (row === 0 || row === 2 || col === 0 || col === 2) && isCorner;
                const isInner = row === 1 && col === 1 && isCorner;
                const isRandom = !isCorner && Math.sin(i * 13.7) > 0.1;
                const filled = isBorder || isInner || isRandom;
                return (
                  <div
                    key={i}
                    className="w-full h-full"
                    style={{ backgroundColor: filled ? "#000" : "transparent" }}
                  />
                );
              })}
            </div>
          </div>

          <div className="text-center">
            <p className="font-bold text-base mb-1" style={{ color: "var(--color-dc-header-primary)" }}>
              Log in with QR Code
            </p>
            <p className="text-sm leading-snug" style={{ color: "var(--color-dc-header-secondary)" }}>
              Scan this with the{" "}
              <span style={{ color: "var(--color-dc-text-link)" }}>Discord mobile app</span>
              {" "}to log in instantly.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
