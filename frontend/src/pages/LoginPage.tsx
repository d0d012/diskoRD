import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
      navigate("/app");
    } catch {
      setError("Invalid email or password.");
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
    >
      <div
        className="w-full max-w-md rounded-md p-8 shadow-xl"
        style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
      >
        <div className="text-center mb-5">
          <h1 className="text-[var(--color-dc-header-primary)] text-2xl font-bold mb-2">
            Welcome back!
          </h1>
          <p className="text-[var(--color-dc-header-secondary)] text-base">
            We're so excited to see you again!
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-[var(--color-dc-header-secondary)] text-xs font-bold uppercase tracking-wide">
              Email or Username <span className="text-[var(--color-dc-red)]">*</span>
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="px-3 py-2.5 rounded text-[var(--color-dc-text-normal)] text-base outline-none focus:ring-2 focus:ring-[var(--color-dc-brand)]"
              style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[var(--color-dc-header-secondary)] text-xs font-bold uppercase tracking-wide">
              Password <span className="text-[var(--color-dc-red)]">*</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="px-3 py-2.5 rounded text-[var(--color-dc-text-normal)] text-base outline-none focus:ring-2 focus:ring-[var(--color-dc-brand)]"
              style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
            />
          </div>

          {error && (
            <p className="text-[var(--color-dc-red)] text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 rounded text-white font-medium text-base transition-colors disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--color-dc-brand)" }}
            onMouseEnter={(e) =>
              ((e.target as HTMLButtonElement).style.backgroundColor =
                "var(--color-dc-brand-560)")
            }
            onMouseLeave={(e) =>
              ((e.target as HTMLButtonElement).style.backgroundColor =
                "var(--color-dc-brand)")
            }
          >
            {isLoading ? "Logging in..." : "Log In"}
          </button>

          <p className="text-[var(--color-dc-text-muted)] text-sm">
            Need an account?{" "}
            <a
              href="/register"
              className="text-[var(--color-dc-text-link)] hover:underline"
            >
              Register
            </a>
          </p>
        </form>
      </div>
    </div>
  );
}
