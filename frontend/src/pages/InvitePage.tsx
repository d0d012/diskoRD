import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useGuildStore } from "../stores/guildStore";
import type { Guild, Channel } from "../types";
import { isTauri } from "../lib/inviteLinks";

export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { guilds, setActiveGuild, setChannels, setGuilds } = useGuildStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleJoin = async () => {
    if (!code) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post(`/invites/${code}/join`);
      const guild: Guild & { channels?: Channel[] } = data.data;

      // Add guild to store if not already there
      const already = guilds.find((g) => g.id === guild.id);
      if (!already) {
        setGuilds([...guilds, guild]);
      }
      if (guild.channels) {
        setChannels(guild.id, guild.channels);
      }
      setActiveGuild(guild.id);
      navigate("/app");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string }; status?: number } };
      const status = err?.response?.status;
      if (status === 409) {
        // Already a member — just navigate to the guild
        navigate("/app");
        return;
      }
      if (status === 410) {
        setError("This invite link has expired or reached its maximum uses.");
      } else if (status === 404) {
        setError("This invite link is invalid.");
      } else {
        setError(err?.response?.data?.error ?? "Failed to join server");
      }
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}
    >
      <div
        className="w-[440px] rounded-[5px] overflow-hidden text-center"
        style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
      >
        {/* Header */}
        <div
          className="h-24 flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, var(--color-dc-brand) 0%, #7289da 100%)",
          }}
        >
          <svg width="48" height="36" viewBox="0 0 71 55" fill="white" aria-hidden="true">
            <path d="M60.105 4.898A58.55 58.55 0 0 0 45.653.415a.22.22 0 0 0-.233.11 40.784 40.784 0 0 0-1.8 3.697c-5.456-.817-10.886-.817-16.23 0-.485-1.164-1.201-2.587-1.828-3.697a.228.228 0 0 0-.233-.11 58.386 58.386 0 0 0-14.451 4.483.207.207 0 0 0-.095.082C1.578 18.73-.944 32.144.293 45.39a.244.244 0 0 0 .093.167c6.073 4.46 11.955 7.167 17.729 8.962a.23.23 0 0 0 .249-.082 42.08 42.08 0 0 0 3.627-5.9.225.225 0 0 0-.123-.312 38.772 38.772 0 0 1-5.539-2.64.228.228 0 0 1-.022-.378 31.17 31.17 0 0 0 1.1-.862.22.22 0 0 1 .23-.03c11.619 5.304 24.198 5.304 35.68 0a.219.219 0 0 1 .233.027 28.246 28.246 0 0 0 1.1.865.228.228 0 0 1-.02.378 36.384 36.384 0 0 1-5.54 2.637.227.227 0 0 0-.121.315 47.249 47.249 0 0 0 3.624 5.897.225.225 0 0 0 .249.084c5.801-1.794 11.684-4.502 17.757-8.961a.228.228 0 0 0 .092-.164c1.48-15.315-2.48-28.618-10.497-40.412a.18.18 0 0 0-.093-.084zm-36.38 32.427c-3.497 0-6.38-3.211-6.38-7.156 0-3.944 2.827-7.156 6.38-7.156 3.583 0 6.438 3.24 6.382 7.156 0 3.945-2.827 7.156-6.381 7.156zm23.593 0c-3.498 0-6.38-3.211-6.38-7.156 0-3.944 2.826-7.156 6.38-7.156 3.582 0 6.437 3.24 6.38 7.156 0 3.945-2.826 7.156-6.38 7.156z"/>
          </svg>
        </div>

        <div className="px-8 py-6">
          <p className="text-sm font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
            You have been invited to join
          </p>
          <h2 className="text-2xl font-bold mb-1" style={{ color: "var(--color-dc-header-primary)" }}>
            a Server
          </h2>
          <p className="text-sm mb-6" style={{ color: "var(--color-dc-text-muted)" }}>
            Invite code: <span className="font-mono font-semibold" style={{ color: "var(--color-dc-text-normal)" }}>{code}</span>
          </p>

          {error && (
            <div
              className="mb-4 px-4 py-3 rounded text-sm text-left"
              style={{ backgroundColor: "rgba(237,66,69,0.15)", color: "var(--color-dc-red)" }}
            >
              {error}
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={loading}
            className="w-full py-3 rounded font-semibold text-base text-white transition-opacity disabled:opacity-50"
            style={{ backgroundColor: "var(--color-dc-brand)" }}
            onMouseEnter={(e) => !loading && (e.currentTarget.style.backgroundColor = "var(--color-dc-brand-560)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-brand)")}
          >
            {loading ? "Joining…" : "Accept Invite"}
          </button>

          {!isTauri() && (
            <a
              href={`diskord://invite/${code}`}
              className="mt-3 block w-full py-2.5 rounded font-semibold text-base no-underline"
              style={{ backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" }}
            >
              Open in diskoRD app
            </a>
          )}

          <button
            onClick={() => navigate("/app")}
            className="mt-3 w-full py-2 text-sm transition-colors"
            style={{ color: "var(--color-dc-text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-text-muted)")}
          >
            Not interested
          </button>
        </div>
      </div>
    </div>
  );
}
