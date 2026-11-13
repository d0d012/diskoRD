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
  const [rememberMe, setRememberMe] = useState(true);
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
      await login(email.trim(), password, rememberMe);
      navigate(returnTo);
    } catch {
      setErrors({ password: "Invalid email or password." });
      triggerShake();
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center py-8"
      style={{ background: "radial-gradient(circle at 18% 22%, rgba(88,101,242,0.24) 0%, transparent 48%), radial-gradient(circle at 82% 78%, rgba(88,101,242,0.14) 0%, transparent 45%), #111214" }}
    >
      <div
        ref={formRef}
        className={`flex rounded-[8px] border border-dc-border-subtle shadow-[0_20px_48px_rgba(0,0,0,0.55)] overflow-hidden w-full max-w-[784px] mx-4 ${shaking ? "motion-safe:animate-[shake_0.4s_ease]" : ""}`}
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
                className={`h-10 px-3 rounded-[4px] text-base outline-none bg-dc-bg-tertiary text-dc-text-body border border-black/30 focus:border-dc-brand focus:shadow-[0_0_0_2px_rgba(88,101,242,0.25)] transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none ${errors.email ? "border-dc-red focus:border-dc-red focus:shadow-[0_0_0_2px_rgba(237,66,69,0.25)]" : ""}`}
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
                <a href="#" className="text-xs font-normal normal-case hover:underline" style={{ color: "var(--color-dc-text-link)" }}>
                  Forgot your password?
                </a>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: undefined })); }}
                className={`h-10 px-3 rounded-[4px] text-base outline-none bg-dc-bg-tertiary text-dc-text-body border border-black/30 focus:border-dc-brand focus:shadow-[0_0_0_2px_rgba(88,101,242,0.25)] transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none ${errors.password ? "border-dc-red focus:border-dc-red focus:shadow-[0_0_0_2px_rgba(237,66,69,0.25)]" : ""}`}
              />
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: "var(--color-dc-header-secondary)" }}>
              <span className="relative inline-flex shrink-0">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="peer appearance-none w-[18px] h-[18px] rounded-[4px] border border-[#80848e] bg-dc-bg-tertiary checked:bg-dc-brand checked:border-dc-brand cursor-pointer transition-colors duration-150 motion-reduce:transition-none forced-colors:appearance-auto"
                />
                <svg className="absolute inset-0 hidden peer-checked:block pointer-events-none text-white forced-colors:hidden" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="m4 9 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              Keep me logged in
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className="dc-btn-primary dc-press w-full h-11 rounded-[4px] bg-dc-brand enabled:hover:bg-dc-brand-560 text-white font-medium text-base mt-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer select-none"
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

        <div className="hidden md:block w-px my-10 bg-dc-border-subtle" />

        {/* QR Code panel */}
        <div
          className="hidden md:flex flex-col items-center justify-center px-10 py-10 gap-5 w-64 flex-shrink-0"
          style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
        >
          {/* QR code placeholder */}
          <div
            className="relative w-40 h-40 rounded-[8px] p-3 bg-white flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
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
            <span aria-hidden="true" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-[8px] bg-dc-brand text-white text-xs font-bold ring-4 ring-white">
              dR
            </span>
          </div>

          <div className="text-center">
            <p className="font-bold text-base mb-1" style={{ color: "var(--color-dc-header-primary)" }}>
              Log in with QR Code
            </p>
            <p className="text-sm leading-snug" style={{ color: "var(--color-dc-header-secondary)" }}>
              Scan this with the{" "}
              <span style={{ color: "var(--color-dc-text-link)" }}>diskoRD mobile app</span>
              {" "}to log in instantly.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
