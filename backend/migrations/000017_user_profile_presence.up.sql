-- Profile fields for the reworked profile card, and the user's chosen presence
-- status. The legacy users.status column (never written) is left untouched.
ALTER TABLE users
    ADD COLUMN bio              VARCHAR(190),
    ADD COLUMN banner_color     VARCHAR(7),
    ADD COLUMN preferred_status VARCHAR(16) NOT NULL DEFAULT 'online';

ALTER TABLE users
    ADD CONSTRAINT users_banner_color_hex CHECK (banner_color IS NULL OR banner_color ~ '^#[0-9a-fA-F]{6}$'),
    ADD CONSTRAINT users_preferred_status_valid CHECK (preferred_status IN ('online', 'idle', 'dnd', 'invisible'));
