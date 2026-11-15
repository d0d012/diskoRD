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

-- Existing DMs use the same creation-time baseline as READY. Seed their
-- counters so the first post-migration message does not hide older unread DMs.
INSERT INTO dm_read_states (user_id, channel_id, last_read_at, mention_count)
SELECT participant.user_id, d.id, d.created_at, count(m.id)::integer
FROM dm_channels d
CROSS JOIN LATERAL (VALUES (d.user_a_id), (d.user_b_id)) participant(user_id)
LEFT JOIN messages m ON m.channel_id = d.id AND m.created_at > d.created_at
    AND m.author_id IS DISTINCT FROM participant.user_id AND m.deleted_at IS NULL
GROUP BY participant.user_id, d.id, d.created_at;
