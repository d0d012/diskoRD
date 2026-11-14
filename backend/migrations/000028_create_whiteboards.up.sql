-- Allow whiteboard channels. The original CHECK in 000004 is inline and unnamed,
-- so Postgres named it channels_type_check.
ALTER TABLE channels DROP CONSTRAINT channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check
    CHECK (type IN ('text', 'voice', 'whiteboard'));

-- One row per whiteboard channel, created lazily on first load or write.
CREATE TABLE whiteboards (
    id         UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
    seq        BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Object ids are client-generated UUIDs. version is the board seq of the last
-- write. body holds the object without its id and version.
CREATE TABLE whiteboard_objects (
    id         UUID PRIMARY KEY,
    board_id   UUID NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
    version    BIGINT NOT NULL CHECK (version > 0),
    body       JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whiteboard_objects_board_id ON whiteboard_objects(board_id);

CREATE TABLE whiteboard_assets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id    UUID NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL UNIQUE,
    mime        VARCHAR(100) NOT NULL,
    bytes       INTEGER NOT NULL CHECK (bytes > 0),
    width       INTEGER NOT NULL CHECK (width > 0),
    height      INTEGER NOT NULL CHECK (height > 0),
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_whiteboard_assets_board_id ON whiteboard_assets(board_id);
CREATE INDEX idx_whiteboard_assets_uploaded_by ON whiteboard_assets(uploaded_by);
