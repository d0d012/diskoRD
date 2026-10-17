CREATE TABLE message_decorations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    doc        JSONB NOT NULL,
    x          SMALLINT NOT NULL CHECK (x BETWEEN 0 AND 100),
    y          SMALLINT NOT NULL CHECK (y BETWEEN 0 AND 64),
    size       SMALLINT NOT NULL CHECK (size IN (32, 48, 64, 96, 128)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_message_decorations_message_id ON message_decorations(message_id);
CREATE INDEX idx_message_decorations_author_id ON message_decorations(author_id);
