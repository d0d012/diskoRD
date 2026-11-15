CREATE TABLE channel_read_states (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL,
    mention_count INTEGER NOT NULL DEFAULT 0 CHECK (mention_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX idx_channel_read_states_channel_id ON channel_read_states(channel_id);
-- Messages have polymorphic channel IDs (guild channels or dm_channels).
-- Separate read-state tables preserve FK cleanup for both kinds.
CREATE TABLE dm_read_states (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL,
    mention_count INTEGER NOT NULL DEFAULT 0 CHECK (mention_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX idx_dm_read_states_channel_id ON dm_read_states(channel_id);

-- Treat everything that existed before this migration as read, so the first
-- launch after deploy does not flag every historical guild message and DM as
-- unread. Channels/DMs created later fall back to joined_at / DM creation.
INSERT INTO channel_read_states (user_id, channel_id, last_read_at)
SELECT gm.user_id, c.id, now()
FROM channels c
JOIN guild_members gm ON gm.guild_id = c.guild_id
WHERE c.type = 'text'
ON CONFLICT DO NOTHING;

INSERT INTO dm_read_states (user_id, channel_id, last_read_at)
SELECT participant.user_id, d.id, now()
FROM dm_channels d
CROSS JOIN LATERAL (VALUES (d.user_a_id), (d.user_b_id)) participant(user_id)
ON CONFLICT DO NOTHING;
