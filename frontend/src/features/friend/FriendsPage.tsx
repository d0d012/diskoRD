import { useEffect, useState } from "react";
import { useShowcaseOverlayStore } from "../../stores/showcaseOverlayStore";
import { Icon } from "../pixelart/Icon";
import { useFriendStore } from "../../stores/friendStore";
import { PresenceDot } from "../../components/ui/PresenceDot";
import { Avatar } from "../../components/ui/Avatar";
import { useLiveUser } from "../../hooks/useLiveUser";
import { api } from "../../lib/api";
import { statusLabel } from "../../lib/avatar";

function UserAvatar({ user, size = 32 }: { user: { id?: string; username: string; avatarUrl?: string | null }; size?: number }) {
  const live = useLiveUser(user.id, user);
  return <Avatar name={live.username ?? user.username} src={live.avatarUrl} size={size} />;
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
    <div className="p-6 border-b border-dc-border-subtle">
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
          className="min-w-0 flex-1 h-10 px-3 rounded-[4px] text-sm outline-none bg-dc-bg-tertiary text-dc-text-body border border-black/30 focus:border-dc-brand focus:shadow-[0_0_0_2px_rgba(88,101,242,0.25)] transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none"
        />
        <button
          onClick={found ? handleSend : handleSearch}
          disabled={!username.trim() || status === "searching"}
          className={`dc-press px-4 h-10 rounded-[4px] text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed ${found ? "bg-dc-green-button hover:bg-dc-green-button-hover" : "dc-btn-primary bg-dc-brand hover:bg-dc-brand-560"}`}
        >
          {found ? "Send Request" : "Search"}
        </button>
      </div>

      {status === "found" && found && (
        <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded"
          style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
          <UserAvatar user={found} size={32} />
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
    <div className="py-4">
      {incoming.length > 0 && (
        <>
          <p className="mx-9 text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--color-dc-text-muted)" }}>
            Incoming — {incoming.length}
          </p>
          {incoming.map((r) => (
            <div key={r.id} className="group flex items-center gap-3 mx-6 px-3 py-2.5 rounded-[8px] border-t border-dc-border-subtle hover:bg-dc-bg-modifier-hover hover:border-transparent [&:hover+*]:border-transparent transition-colors duration-100 motion-reduce:transition-none">
              <div className="relative">
                <UserAvatar user={r.user} size={32} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>{r.user.username}</p>
                <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>Incoming Friend Request</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => acceptRequest(r.id)}
                  className="dc-press w-9 h-9 rounded-full flex items-center justify-center bg-dc-bg-secondary group-hover:bg-dc-bg-tertiary text-dc-interactive-normal hover:text-dc-online transition-colors duration-100 motion-reduce:transition-none"
                  title="Accept"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
                <button
                  onClick={() => declineRequest(r.id)}
                  className="dc-press w-9 h-9 rounded-full flex items-center justify-center bg-dc-bg-secondary group-hover:bg-dc-bg-tertiary text-dc-interactive-normal hover:text-dc-red transition-colors duration-100 motion-reduce:transition-none"
                  title="Decline"
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
          <p className="mx-9 text-xs font-semibold uppercase tracking-wide mt-4 mb-3" style={{ color: "var(--color-dc-text-muted)" }}>
            Outgoing — {outgoing.length}
          </p>
          {outgoing.map((r) => (
            <div key={r.id} className="group flex items-center gap-3 mx-6 px-3 py-2.5 rounded-[8px] border-t border-dc-border-subtle hover:bg-dc-bg-modifier-hover hover:border-transparent [&:hover+*]:border-transparent transition-colors duration-100 motion-reduce:transition-none">
              <UserAvatar user={r.user} size={32} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>{r.user.username}</p>
                <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>Outgoing Friend Request</p>
              </div>
              <button
                onClick={() => declineRequest(r.id)}
                className="dc-press w-9 h-9 rounded-full flex items-center justify-center bg-dc-bg-secondary group-hover:bg-dc-bg-tertiary text-dc-interactive-normal hover:text-dc-red transition-colors duration-100 motion-reduce:transition-none"
                title="Cancel"
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

function FriendsList({ onAddFriend }: { onAddFriend: () => void }) {
  const { friends, openDM, removeFriend } = useFriendStore();
  const online = friends.filter((f) => f.status !== "offline");
  const offline = friends.filter((f) => f.status === "offline");

  if (friends.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
        <svg width="180" height="120" viewBox="0 0 180 120" fill="none" aria-hidden="true" className="mb-4">
          <ellipse cx="90" cy="106" rx="75" ry="8" fill="#2b2d31" />
          <rect x="18" y="16" width="100" height="66" rx="8" fill="#2b2d31" />
          <path d="M38 78v17l20-17" fill="#2b2d31" />
          <circle cx="52" cy="46" r="12" fill="#4e5058" />
          <path d="M32 72c0-12 9-18 20-18s20 6 20 18" fill="#4e5058" />
          <rect x="78" y="42" width="84" height="54" rx="8" fill="#4e5058" />
          <path d="M142 92v14l-18-14" fill="#4e5058" />
          <path d="M98 66h44M98 76h28" stroke="#2b2d31" strokeWidth="5" strokeLinecap="round" />
          <circle cx="146" cy="26" r="14" fill="#5865f2" />
          <path d="M146 20v12m-6-6h12" stroke="#f2f3f5" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <p className="text-base font-semibold text-dc-header-primary">No friends yet</p>
        <p className="text-sm text-dc-text-muted max-w-[340px]">
          Find your people. Search for a username and send your first friend request.
        </p>
        <button onClick={onAddFriend} className="dc-btn-primary dc-press mt-3 px-4 h-10 rounded-[4px] bg-dc-brand hover:bg-dc-brand-560 text-sm font-medium text-white">
          Add a Friend
        </button>
      </div>
    );
  }

  function FriendRow({ f, friendshipId }: { f: typeof friends[0]; friendshipId: string }) {
    return (
      <div className="group flex items-center gap-3 mx-6 px-3 py-2.5 rounded-[8px] border-t border-dc-border-subtle hover:bg-dc-bg-modifier-hover hover:border-transparent [&:hover+*]:border-transparent transition-colors duration-100 motion-reduce:transition-none">
        <div className="relative">
          <UserAvatar user={f} size={32} />
          <PresenceDot status={f.status} size={12} borderColor="var(--color-dc-bg-primary)" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>{f.username}</p>
          <p className="text-xs" style={{ color: "var(--color-dc-text-muted)" }}>{statusLabel(f.status)}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => openDM(f.id)}
            className="dc-press w-9 h-9 rounded-full flex items-center justify-center bg-dc-bg-secondary group-hover:bg-dc-bg-tertiary text-dc-interactive-normal hover:text-dc-header-primary transition-colors duration-100 motion-reduce:transition-none"
            title="Send Message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
          </button>
          <button
            onClick={() => useShowcaseOverlayStore.getState().open(f.id)}
            className="dc-press w-9 h-9 rounded-full flex items-center justify-center bg-dc-bg-secondary group-hover:bg-dc-bg-tertiary text-dc-interactive-normal hover:text-dc-header-primary transition-colors duration-100 motion-reduce:transition-none"
            title="View Showcase"
            aria-label={`View ${f.username}'s showcase`}
          >
            <Icon name="showcase" size={16} />
          </button>
          <button
            onClick={() => removeFriend(friendshipId)}
            className="dc-press w-9 h-9 rounded-full flex items-center justify-center bg-dc-bg-secondary group-hover:bg-dc-bg-tertiary text-dc-interactive-normal hover:text-dc-red transition-colors duration-100 motion-reduce:transition-none"
            title="Remove Friend"
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
    <div className="py-4">
      {online.length > 0 && (
        <>
          <p className="mx-9 text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
            Online — {online.length}
          </p>
          {online.map((f) => <FriendRow key={f.id} f={f} friendshipId={f.id} />)}
        </>
      )}
      {offline.length > 0 && (
        <>
          <p className="mx-9 text-xs font-semibold uppercase tracking-wide mt-4 mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
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
  const [tab, setTab] = useState<"all" | "pending" | "add">("all");
  const pendingCount = requests.filter((r) => r.direction === "incoming").length;

  useEffect(() => {
    fetchFriends();
    fetchRequests();
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
      {/* Header */}
      <div className="relative z-10 h-12 px-4 flex items-center gap-4 flex-shrink-0 shadow-dc-header">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-text-muted)" }}>
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
        <span className="font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>Friends</span>
        <div className="w-px h-5 mx-1 bg-dc-border-subtle" />
        {(["all", "pending"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`dc-press relative px-2.5 py-1 rounded-[4px] text-sm font-medium transition-colors duration-150 motion-reduce:transition-none ${tab === t ? "bg-dc-bg-modifier-selected text-dc-header-primary" : "text-dc-interactive-normal hover:bg-dc-bg-modifier-hover hover:text-dc-text-body"}`}>
            {t === "all" ? "All" : "Pending"}
            {t === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs text-white"
                style={{ backgroundColor: "var(--color-dc-red)", fontSize: "10px" }}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
        <button onClick={() => setTab("add")}
          className={`dc-press px-2.5 py-1 rounded-[4px] text-sm font-medium whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none ${tab === "add" ? "bg-[rgba(35,165,89,0.2)] text-dc-green-text" : "bg-dc-green-button text-white hover:bg-dc-green-button-hover"}`}>
          Add Friend
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {tab === "add" ? <AddFriendSection /> : tab === "pending" ? <PendingRequests /> : <FriendsList onAddFriend={() => setTab("add")} />}
      </div>
    </div>
  );
}
