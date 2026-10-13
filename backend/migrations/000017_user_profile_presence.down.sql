ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_preferred_status_valid,
    DROP CONSTRAINT IF EXISTS users_banner_color_hex,
    DROP COLUMN IF EXISTS preferred_status,
    DROP COLUMN IF EXISTS banner_color,
    DROP COLUMN IF EXISTS bio;
