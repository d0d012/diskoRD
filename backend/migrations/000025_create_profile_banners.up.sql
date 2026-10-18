-- A profile's pixel art banner: a built-in scene id or the user's own drawing.
CREATE TABLE profile_banners (
    user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    builtin    VARCHAR(32),
    doc        JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((builtin IS NULL) <> (doc IS NULL))
);
