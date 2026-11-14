-- Deleting whiteboard channels cascades to their boards, objects and assets.
-- Do this before restoring the narrower CHECK so the down never fails and
-- leaves golang-migrate dirty.
DELETE FROM channels WHERE type = 'whiteboard';

DROP TABLE IF EXISTS whiteboard_assets;
DROP TABLE IF EXISTS whiteboard_objects;
DROP TABLE IF EXISTS whiteboards;

ALTER TABLE channels DROP CONSTRAINT channels_type_check;
ALTER TABLE channels ADD CONSTRAINT channels_type_check
    CHECK (type IN ('text', 'voice'));
