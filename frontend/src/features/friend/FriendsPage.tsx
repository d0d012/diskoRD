import { useEffect, useState } from "react";
import { useFriendStore } from "../../stores/friendStore";
import { PresenceDot } from "../../components/ui/PresenceDot";
import { api } from "../../lib/api";

function UserAvatar({ username, size = 8 }: { username: string; size?: number }) {
  const color = `hsl(${(username.charCodeAt(0) * 37) % 360}, 55%, 45%)`;
  const px = size * 4; // Tailwind size to px
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 relative`}
      style={{ backgroundColor: color, width: px, height: px, fontSize: px * 0.4 }}
    >
      {username[0]?.toUpperCase()}
    </div>
  );
}

function AddFriendSection() {
  const { sendRequest } = useFriendStore();
  const [username, setUsername] = useState("");
  const [found, setFound] = useState<{ id: string; username: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "searching" | "found" | "not_found" | "success" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function handleSearch() {
    const q = username.trim();
    if (!q) return;
    setStatus("searching");
    setFound(null);
    try {
      const { data } = await api.get(`/users/search?username=${encodeURIComponent(q)}`);
      setFound({ id: data.data.id, username: data.data.username });
      setStatus("found");
    } catch {
      setStatus("not_found");
      setMsg("No user found with that username.");
    }
  }

  async function handleSend() {
    if (!found) return;
    try {
      await sendRequest(found.id);
      setStatus("success");
      setMsg(`Friend request sent to ${found.username}!`);
      setUsername("");
      setFound(null);
    } catch (e: unknown) {
      setStatus("error");
      const err = e as { response?: { data?: { error?: string } } };
      setMsg(err?.response?.data?.error ?? "Failed to send request");
    }
    setTimeout(() => setStatus("idle"), 3000);
  }

  return (
    <div className="p-6 border-b" style={{ borderColor: "var(--color-dc-bg-floating)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "var(--color-dc-text-muted)" }}>
        Add Friend
      </h2>
      <p className="text-sm mb-3" style={{ color: "var(--color-dc-text-muted)" }}>
        Search by username to send a friend request.
      </p>
      <div className="flex gap-2">
        <input
          value={username}
          onChange={(e) => { setUsername(e.target.value); setStatus("idle"); setFound(null); }}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Enter a username"
          className="flex-1 px-3 py-2 rounded text-sm outline-none"
          style={{
            backgroundColor: "var(--color-dc-bg-tertiary)",
            color: "var(--color-dc-text-normal)",
            border: "1px solid var(--color-dc-bg-floating)",
          }}
        />
        <button
          onClick={found ? handleSend : handleSearch}
          disabled={!username.trim() || status === "searching"}
          className="px-4 py-2 rounded text-sm font-semibold text-white transition-colors"
          style={{ backgroundColor: found ? "var(--color-dc-online)" : "var(--color-dc-brand)" }}
        >
          {found ? "Send Request" : "Search"}
        </button>
      </div>

      {status === "found" && found && (
        <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded"
          style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
            style={{ backgroundColor: `hsl(${(found.username.charCodeAt(0) * 37) % 360}, 55%, 45%)` }}>
            {found.username[0]?.toUpperCase()}
          </div>
          <span className="text-sm font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>{found.username}</span>
        </div>
      )}

      {(status === "not_found" || status === "success" || status === "error") && (
        <p className="text-xs mt-2" style={{
          color: status === "success" ? "var(--color-dc-online)" : "var(--color-dc-red)"
        }}>
          {msg}
        </p>
      )}
    </div>
  );
}

function PendingRequests() {
  const { requests, acceptRequest, declineRequest } = useFriendStore();
  const incoming = requests.filter((r) => r.direction === "incoming");
  const outgoing = requests.filter((r) => r.direction === "outgoing");

  if (requests.length === 0) return null;

  return (
    <div className="p-4">
      {incoming.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--color-dc-text-muted)" }}>
            Incoming — {incoming.length}
          </p>
          {incoming.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-2 py-2 rounded-lg mb-1"
              style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
              <div className="relative">
                <UserAvatar username={r.user.username} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>{r.user.username}</p>
                <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>Incoming Friend Request</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => acceptRequest(r.id)}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                  style={{ backgroundColor: "var(--color-dc-bg-modifier-hover)" }}
                  title="Accept"
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-online)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
                <button
                  onClick={() => declineRequest(r.id)}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                  style={{ backgroundColor: "var(--color-dc-bg-modifier-hover)", color: "var(--color-dc-text-muted)" }}
                  title="Decline"
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-red)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {outgoing.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide mt-4 mb-3" style={{ color: "var(--color-dc-text-muted)" }}>
            Outgoing — {outgoing.length}
          </p>
          {outgoing.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-2 py-2 rounded-lg mb-1"
              style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
              <UserAvatar username={r.user.username} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>{r.user.username}</p>
                <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>Outgoing Friend Request</p>
              </div>
              <button
                onClick={() => declineRequest(r.id)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ backgroundColor: "var(--color-dc-bg-modifier-hover)", color: "var(--color-dc-text-muted)" }}
                title="Cancel"
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-red)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function FriendsList() {
  const { friends, openDM, removeFriend } = useFriendStore();
  const online = friends.filter((f) => f.status === "online");
  const offline = friends.filter((f) => f.status !== "online");

  if (friends.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8">
        <p className="text-base font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>No friends yet</p>
        <p className="text-sm text-center" style={{ color: "var(--color-dc-text-muted)" }}>
          Add friends by sharing your user ID or entering theirs above.
        </p>
      </div>
    );
  }

  function FriendRow({ f, friendshipId }: { f: typeof friends[0]; friendshipId: string }) {
    return (
      <div className="flex items-center gap-3 px-2 py-2 rounded-lg mb-1 group transition-colors cursor-pointer"
        style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-secondary)")}
      >
        <div className="relative">
          <UserAvatar username={f.username} />
          <PresenceDot status={f.status} borderColor="var(--color-dc-bg-secondary)" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>{f.username}</p>
          <p className="text-xs capitalize" style={{ color: "var(--color-dc-text-muted)" }}>{f.status}</p>
        </div>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => openDM(f.id)}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-interactive-normal)" }}
            title="Send Message"
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
          </button>
          <button
            onClick={() => removeFriend(friendshipId)}
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-dc-bg-tertiary)", color: "var(--color-dc-interactive-normal)" }}
            title="Remove Friend"
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-red)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal)")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {online.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
            Online — {online.length}
          </p>
          {online.map((f) => <FriendRow key={f.id} f={f} friendshipId={f.id} />)}
        </>
      )}
      {offline.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide mt-4 mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
            Offline — {offline.length}
          </p>
          {offline.map((f) => <FriendRow key={f.id} f={f} friendshipId={f.id} />)}
        </>
      )}
    </div>
  );
}

export function FriendsPage() {
  const { fetchFriends, fetchRequests, requests } = useFriendStore();
  const [tab, setTab] = useState<"all" | "pending">("all");
  const pendingCount = requests.filter((r) => r.direction === "incoming").length;

  useEffect(() => {
    fetchFriends();
    fetchRequests();
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
      {/* Header */}
      <div className="h-12 px-4 flex items-center gap-4 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-dc-bg-floating)" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-text-muted)" }}>
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
        <span className="font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>Friends</span>
        <div className="w-px h-5 mx-1" style={{ backgroundColor: "var(--color-dc-bg-floating)" }} />
        {(["all", "pending"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-3 py-1 rounded text-sm font-medium transition-colors relative"
            style={{
              backgroundColor: tab === t ? "var(--color-dc-bg-modifier-selected)" : "transparent",
              color: tab === t ? "var(--color-dc-header-primary)" : "var(--color-dc-interactive-normal)",
            }}>
            {t === "all" ? "All" : "Pending"}
            {t === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs text-white"
                style={{ backgroundColor: "var(--color-dc-red)", fontSize: "10px" }}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <AddFriendSection />

      <div className="flex-1 overflow-y-auto">
        {tab === "pending" ? <PendingRequests /> : <FriendsList />}
      </div>
    </div>
  );
}
