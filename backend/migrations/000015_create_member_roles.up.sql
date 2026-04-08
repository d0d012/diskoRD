CREATE TABLE member_roles (
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id  UUID NOT NULL REFERENCES guild_roles(id) ON DELETE CASCADE,
    PRIMARY KEY (guild_id, user_id, role_id)
);

CREATE INDEX idx_member_roles_guild_user ON member_roles(guild_id, user_id);
CREATE INDEX idx_member_roles_role_id ON member_roles(role_id);
