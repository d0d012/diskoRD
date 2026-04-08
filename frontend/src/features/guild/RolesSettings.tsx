import { useEffect, useState } from "react";
import { useGuildStore } from "../../stores/guildStore";
import { api } from "../../lib/api";

const PRESET_COLORS = [
  "#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63",
  "#f1c40f", "#e67e22", "#e74c3c", "#95a5a6", "#607d8b",
  "#11806a", "#1f8b4c", "#206694", "#71368a", "#ad1457",
  "#c27c0e", "#a84300", "#992d22", "#979c9f", "#546e7a",
];

interface RoleMember { id: string; username: string }

interface Props {
  guildId: string;
}

export function RolesSettings({ guildId }: Props) {
  const roles = useGuildStore((s) => s.roles[guildId] ?? []);
  const { fetchRoles, createRole, updateRole, deleteRole } = useGuildStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"display" | "members">("display");

  // Edit form state
  const [name, setName] = useState("");
  const [color, setColor] = useState("#99aab5");
  const [hoist, setHoist] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Members tab
  const [roleMembers, setRoleMembers] = useState<RoleMember[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [allMembers, setAllMembers] = useState<RoleMember[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);

  const selectedRole = roles.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    fetchRoles(guildId);
  }, [guildId]);

  useEffect(() => {
    if (selectedRole) {
      setName(selectedRole.name);
      setColor(selectedRole.color);
      setHoist(selectedRole.hoist);
      setDirty(false);
      setActiveTab("display");
    }
  }, [selectedId]);

  useEffect(() => {
    if (activeTab === "members" && selectedId) {
      setMemberLoading(true);
      api.get(`/guilds/${guildId}/roles/${selectedId}/members`)
        .then(({ data }) => setRoleMembers(data.data ?? []))
        .catch(() => {})
        .finally(() => setMemberLoading(false));
      api.get(`/guilds/${guildId}/members`)
        .then(({ data }) => setAllMembers((data.data ?? []).map((m: { id: string; username: string }) => ({ id: m.id, username: m.username }))))
        .catch(() => {});
    }
  }, [activeTab, selectedId, guildId]);

  async function handleCreate() {
    const role = await createRole(guildId, "new role", "#99aab5", false);
    setSelectedId(role.id);
  }

  async function handleSave() {
    if (!selectedId || !dirty) return;
    setSaving(true);
    try {
      await updateRole(guildId, selectedId, { name, color, hoist });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedId) return;
    if (!confirm(`Delete role "${selectedRole?.name}"?`)) return;
    await deleteRole(guildId, selectedId);
    setSelectedId(null);
  }

  async function assignMemberToRole(userId: string) {
    if (!selectedId) return;
    await api.put(`/guilds/${guildId}/members/${userId}/roles/${selectedId}`);
    const member = allMembers.find((m) => m.id === userId);
    if (member) setRoleMembers((prev) => [...prev, member]);
  }

  async function removeMemberFromRole(userId: string) {
    if (!selectedId) return;
    await api.delete(`/guilds/${guildId}/members/${userId}/roles/${selectedId}`);
    setRoleMembers((prev) => prev.filter((m) => m.id !== userId));
  }

  const assignedIds = new Set(roleMembers.map((m) => m.id));
  const assignable = allMembers.filter(
    (m) => !assignedIds.has(m.id) && m.username.toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="flex h-full">
      {/* Left: role list */}
      <div
        className="w-64 flex-shrink-0 flex flex-col border-r overflow-y-auto"
        style={{ borderColor: "var(--color-dc-bg-floating)" }}
      >
        <div className="p-4 flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-dc-text-muted)" }}>
            Roles — {roles.length}
          </span>
          <button
            onClick={handleCreate}
            title="Create Role"
            className="w-6 h-6 rounded flex items-center justify-center transition-colors"
            style={{ color: "var(--color-dc-interactive-normal)" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
          </button>
        </div>

        <div className="flex-1 pb-4">
          {[...roles].sort((a, b) => b.position - a.position).map((role) => (
            <button
              key={role.id}
              onClick={() => setSelectedId(role.id)}
              className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
              style={{
                backgroundColor: selectedId === role.id ? "var(--color-dc-bg-modifier-selected)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (selectedId !== role.id) e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)";
              }}
              onMouseLeave={(e) => {
                if (selectedId !== role.id) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: role.color }} />
              <span className="flex-1 text-sm truncate" style={{ color: "var(--color-dc-text-normal)" }}>
                {role.name}
              </span>
              <span className="text-xs flex-shrink-0" style={{ color: "var(--color-dc-text-muted)" }}>
                {role.memberCount ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedRole ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>
              Select a role to edit, or create a new one.
            </p>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex border-b px-6 pt-4 flex-shrink-0" style={{ borderColor: "var(--color-dc-bg-floating)" }}>
              {(["display", "members"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px"
                  style={{
                    borderColor: activeTab === tab ? "var(--color-dc-brand)" : "transparent",
                    color: activeTab === tab ? "var(--color-dc-header-primary)" : "var(--color-dc-text-muted)",
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === "display" && (
                <div className="space-y-6 max-w-lg">
                  {/* Role Name */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
                      Role Name
                    </label>
                    <input
                      value={name}
                      onChange={(e) => { setName(e.target.value); setDirty(true); }}
                      className="w-full px-3 py-2 rounded text-sm outline-none"
                      style={{
                        backgroundColor: "var(--color-dc-bg-tertiary)",
                        color: "var(--color-dc-text-normal)",
                        border: "1px solid var(--color-dc-bg-floating)",
                      }}
                    />
                  </div>

                  {/* Role Color */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
                      Role Color
                    </label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => { setColor(c); setDirty(true); }}
                          className="w-7 h-7 rounded-full transition-transform hover:scale-110 flex-shrink-0"
                          style={{
                            backgroundColor: c,
                            outline: color === c ? `2px solid white` : "none",
                            outlineOffset: 2,
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded flex-shrink-0" style={{ backgroundColor: color }} />
                      <input
                        value={color}
                        onChange={(e) => { setColor(e.target.value); setDirty(true); }}
                        className="px-2 py-1 rounded text-sm outline-none font-mono uppercase w-28"
                        style={{
                          backgroundColor: "var(--color-dc-bg-tertiary)",
                          color: "var(--color-dc-text-normal)",
                          border: "1px solid var(--color-dc-bg-floating)",
                        }}
                        maxLength={7}
                        placeholder="#99AAB5"
                      />
                    </div>
                  </div>

                  {/* Hoist */}
                  <div className="flex items-center justify-between py-3 px-4 rounded-lg" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--color-dc-header-primary)" }}>
                        Display role members separately
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-dc-text-muted)" }}>
                        Members with this role appear in their own section in the member list
                      </p>
                    </div>
                    <button
                      onClick={() => { setHoist(!hoist); setDirty(true); }}
                      className="w-10 h-6 rounded-full transition-colors flex-shrink-0 relative ml-4"
                      style={{ backgroundColor: hoist ? "var(--color-dc-brand)" : "var(--color-dc-bg-floating)" }}
                    >
                      <span
                        className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform"
                        style={{ left: hoist ? "calc(100% - 20px)" : 4 }}
                      />
                    </button>
                  </div>

                  {/* Delete */}
                  <div className="pt-2">
                    <button
                      onClick={handleDelete}
                      className="text-sm px-3 py-1.5 rounded transition-colors"
                      style={{ color: "var(--color-dc-red, #da373c)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(218,55,60,0.1)")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      Delete Role
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "members" && (
                <div className="max-w-lg space-y-4">
                  {/* Current members */}
                  {memberLoading ? (
                    <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>Loading…</p>
                  ) : (
                    <>
                      {roleMembers.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
                            Members — {roleMembers.length}
                          </p>
                          <div className="space-y-1">
                            {roleMembers.map((m) => (
                              <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
                                <span className="text-sm" style={{ color: "var(--color-dc-text-normal)" }}>{m.username}</span>
                                <button
                                  onClick={() => removeMemberFromRole(m.id)}
                                  className="text-xs px-2 py-0.5 rounded transition-colors"
                                  style={{ color: "var(--color-dc-red, #da373c)" }}
                                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(218,55,60,0.1)")}
                                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Add members */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-dc-text-muted)" }}>
                          Add Members
                        </p>
                        <input
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          placeholder="Search members..."
                          className="w-full px-3 py-2 rounded text-sm outline-none mb-2"
                          style={{
                            backgroundColor: "var(--color-dc-bg-tertiary)",
                            color: "var(--color-dc-text-normal)",
                            border: "1px solid var(--color-dc-bg-floating)",
                          }}
                        />
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {assignable.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => assignMemberToRole(m.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors"
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-interactive-normal)" }}>
                                <path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                              </svg>
                              <span className="text-sm" style={{ color: "var(--color-dc-text-normal)" }}>{m.username}</span>
                            </button>
                          ))}
                          {assignable.length === 0 && memberSearch && (
                            <p className="text-xs px-2 py-2" style={{ color: "var(--color-dc-text-muted)" }}>No members found</p>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Save bar */}
            {dirty && activeTab === "display" && (
              <div
                className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-t"
                style={{ borderColor: "var(--color-dc-bg-floating)", backgroundColor: "var(--color-dc-bg-secondary)" }}
              >
                <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>Careful — you have unsaved changes!</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (selectedRole) {
                        setName(selectedRole.name);
                        setColor(selectedRole.color);
                        setHoist(selectedRole.hoist);
                        setDirty(false);
                      }
                    }}
                    className="px-3 py-1.5 text-sm rounded transition-colors"
                    style={{ color: "var(--color-dc-text-normal)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    Reset
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-1.5 text-sm rounded font-medium transition-colors"
                    style={{ backgroundColor: "var(--color-dc-brand)", color: "white", opacity: saving ? 0.7 : 1 }}
                  >
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
