CREATE TABLE pixel_arts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             VARCHAR(40) NOT NULL DEFAULT '',
    doc               JSONB NOT NULL,
    showcase_position SMALLINT CHECK (showcase_position BETWEEN 0 AND 14),
    -- Remix credit: the piece it was copied from, and that piece's owner. The author
    -- survives the source being deleted so "remixed from @x" keeps working.
    remix_of          UUID REFERENCES pixel_arts(id) ON DELETE SET NULL,
    remix_author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pixel_arts_owner_id ON pixel_arts(owner_id);
CREATE INDEX idx_pixel_arts_remix_of ON pixel_arts(remix_of);
CREATE INDEX idx_pixel_arts_remix_author_id ON pixel_arts(remix_author_id);
CREATE UNIQUE INDEX idx_pixel_arts_showcase ON pixel_arts(owner_id, showcase_position) WHERE showcase_position IS NOT NULL;

CREATE TABLE profile_buddies (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    art_id     UUID NOT NULL REFERENCES pixel_arts(id) ON DELETE CASCADE,
    position   SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 4),
    -- x: left edge in % of the card width; y: px from the card top.
    x          SMALLINT NOT NULL CHECK (x BETWEEN 0 AND 100),
    y          SMALLINT NOT NULL CHECK (y BETWEEN 0 AND 1000),
    height     SMALLINT NOT NULL CHECK (height BETWEEN 16 AND 128),
    flip       BOOLEAN NOT NULL DEFAULT false,
    front      BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (owner_id, position)
);
CREATE INDEX idx_profile_buddies_art_id ON profile_buddies(art_id);
