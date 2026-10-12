CREATE TABLE guild_sounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id UUID NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(32) NOT NULL CHECK (length(trim(name)) > 0),
    audio BYTEA NOT NULL CHECK (octet_length(audio) BETWEEN 46 AND 240044),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_guild_sounds_guild_id ON guild_sounds(guild_id);
CREATE INDEX idx_guild_sounds_creator_id ON guild_sounds(creator_id);
