import { useState, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

interface FieldErrors {
  email?: string;
  displayName?: string;
  username?: string;
  password?: string;
  dob?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [marketingEmails, setMarketingEmails] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [shaking, setShaking] = useState(false);
  const { register, isLoading } = useAuthStore();
  const navigate = useNavigate();
  const formRef = useRef<HTMLDivElement>(null);

  function triggerShake() {
    setShaking(true);
    setTimeout(() => setShaking(false), 400);
  }

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!email.trim()) e.email = "This field is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Not a valid email address.";
    if (!username.trim()) e.username = "This field is required.";
    if (!password) e.password = "This field is required.";
    else if (password.length < 8) e.password = "Must be 8 or more in length.";
    if (!month || !day || !year) e.dob = "You must enter your date of birth.";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const newErrors = validate();
    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      triggerShake();
      return;
    }
    try {
      await register(email.trim(), displayName.trim() || username.trim(), username.trim(), password);
      navigate("/app");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Something went wrong.";
      if (msg.includes("username")) setErrors({ username: msg });
      else if (msg.includes("email")) setErrors({ email: msg });
      else setErrors({ email: msg });
      triggerShake();
    }
  }

  function fieldLabel(label: string, required: boolean, error?: string) {
    return (
      <label className="text-xs font-bold uppercase tracking-wide" style={{ color: error ? "var(--color-dc-red)" : "var(--color-dc-header-secondary)" }}>
        {error ? (
          <span>{label} <span className="font-normal normal-case italic">- {error}</span></span>
        ) : (
          <span>{label}{required && <span style={{ color: "var(--color-dc-red)" }}> *</span>}</span>
        )}
      </label>
    );
  }

  function fieldInput(value: string, onChange: (v: string) => void, type = "text", error?: string) {
    return (
      <input
        type={type}
        value={value}
        onChange={(e) => { onChange(e.target.value); setErrors((p) => ({ ...p })); }}
        className="px-2.5 py-2 rounded text-base outline-none focus:ring-2 w-full"
        style={{
          backgroundColor: "var(--color-dc-bg-tertiary)",
          color: "var(--color-dc-text-normal)",
          border: error ? "1px solid var(--color-dc-red)" : "none",
          borderRadius: "3px",
        }}
      />
    );
  }

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 120 }, (_, i) => currentYear - i);
  const daysInMonth = month && year
    ? new Date(Number(year), MONTHS.indexOf(month) + 1, 0).getDate()
    : 31;

  return (
    <div
      className="min-h-screen flex items-center justify-center py-8"
      style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
    >
      <div
        ref={formRef}
        className={`w-full max-w-md mx-4 rounded-md shadow-2xl px-8 py-8 ${shaking ? "shake" : ""}`}
        style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
      >
        <h1 className="text-center text-2xl font-bold mb-1" style={{ color: "var(--color-dc-header-primary)" }}>
          Create an account
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-5">
          {/* Email */}
          <div className="flex flex-col gap-2">
            {fieldLabel("Email", true, errors.email)}
            {fieldInput(email, (v) => { setEmail(v); setErrors((p) => ({ ...p, email: undefined })); }, "email", errors.email)}
          </div>

          {/* Display Name */}
          <div className="flex flex-col gap-2">
            {fieldLabel("Display Name", false, errors.displayName)}
            {fieldInput(displayName, setDisplayName, "text", errors.displayName)}
          </div>

          {/* Username */}
          <div className="flex flex-col gap-2">
            {fieldLabel("Username", true, errors.username)}
            {fieldInput(username, (v) => { setUsername(v); setErrors((p) => ({ ...p, username: undefined })); }, "text", errors.username)}
          </div>

          {/* Password */}
          <div className="flex flex-col gap-2">
            {fieldLabel("Password", true, errors.password)}
            {fieldInput(password, (v) => { setPassword(v); setErrors((p) => ({ ...p, password: undefined })); }, "password", errors.password)}
          </div>

          {/* Date of Birth */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-wide" style={{ color: errors.dob ? "var(--color-dc-red)" : "var(--color-dc-header-secondary)" }}>
              {errors.dob ? (
                <span>Date of Birth <span className="font-normal normal-case italic">- {errors.dob}</span></span>
              ) : (
                <span>Date of Birth <span style={{ color: "var(--color-dc-red)" }}>*</span></span>
              )}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {/* Month */}
              <select
                value={month}
                onChange={(e) => { setMonth(e.target.value); setErrors((p) => ({ ...p, dob: undefined })); }}
                className="px-2.5 py-2 rounded text-base outline-none cursor-pointer"
                style={{
                  backgroundColor: "var(--color-dc-bg-tertiary)",
                  color: month ? "var(--color-dc-text-normal)" : "var(--color-dc-text-muted)",
                  border: errors.dob ? "1px solid var(--color-dc-red)" : "none",
                  borderRadius: "3px",
                  appearance: "none",
                }}
              >
                <option value="" disabled>Month</option>
                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {/* Day */}
              <select
                value={day}
                onChange={(e) => { setDay(e.target.value); setErrors((p) => ({ ...p, dob: undefined })); }}
                className="px-2.5 py-2 rounded text-base outline-none cursor-pointer"
                style={{
                  backgroundColor: "var(--color-dc-bg-tertiary)",
                  color: day ? "var(--color-dc-text-normal)" : "var(--color-dc-text-muted)",
                  border: errors.dob ? "1px solid var(--color-dc-red)" : "none",
                  borderRadius: "3px",
                  appearance: "none",
                }}
              >
                <option value="" disabled>Day</option>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {/* Year */}
              <select
                value={year}
                onChange={(e) => { setYear(e.target.value); setErrors((p) => ({ ...p, dob: undefined })); }}
                className="px-2.5 py-2 rounded text-base outline-none cursor-pointer"
                style={{
                  backgroundColor: "var(--color-dc-bg-tertiary)",
                  color: year ? "var(--color-dc-text-normal)" : "var(--color-dc-text-muted)",
                  border: errors.dob ? "1px solid var(--color-dc-red)" : "none",
                  borderRadius: "3px",
                  appearance: "none",
                }}
              >
                <option value="" disabled>Year</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {/* Marketing emails */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={marketingEmails}
              onChange={(e) => setMarketingEmails(e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer"
              style={{ accentColor: "var(--color-dc-brand)" }}
            />
            <span className="text-xs leading-snug" style={{ color: "var(--color-dc-header-secondary)" }}>
              (Optional) It's okay to send me emails with Discord updates, tips, and special offers. You can opt out at any time.
            </span>
          </label>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 text-white font-medium text-base mt-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer select-none"
            style={{ backgroundColor: "var(--color-dc-brand)", borderRadius: "3px" }}
            onMouseEnter={(e) => { if (!isLoading) (e.currentTarget.style.backgroundColor = "var(--color-dc-brand-560)"); }}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-brand)")}
          >
            {isLoading ? "Creating account..." : "Continue"}
          </button>

          <p className="text-xs leading-snug" style={{ color: "var(--color-dc-text-muted)" }}>
            By registering, you agree to Discord's{" "}
            <a href="#" style={{ color: "var(--color-dc-text-link)" }} className="hover:underline">Terms of Service</a>
            {" "}and{" "}
            <a href="#" style={{ color: "var(--color-dc-text-link)" }} className="hover:underline">Privacy Policy</a>.
          </p>

          <Link to="/login" style={{ color: "var(--color-dc-text-link)" }} className="text-sm hover:underline">
            Already have an account?
          </Link>
        </form>
      </div>
    </div>
  );
}
