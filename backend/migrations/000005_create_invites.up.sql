CREATE TABLE invites (
    code       VARCHAR(10) PRIMARY KEY,
    guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    max_uses   INTEGER,
    use_count  INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invites_guild_id ON invites(guild_id);
