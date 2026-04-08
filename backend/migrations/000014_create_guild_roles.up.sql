CREATE TABLE guild_roles (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id   UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name       VARCHAR(100) NOT NULL,
    color      VARCHAR(7) NOT NULL DEFAULT '#99aab5',
    position   INT NOT NULL DEFAULT 0,
    hoist      BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_guild_roles_guild_id ON guild_roles(guild_id);
