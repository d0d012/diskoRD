DROP INDEX IF EXISTS idx_whiteboard_objects_author;
DROP INDEX IF EXISTS idx_whiteboard_objects_board_author;
ALTER TABLE whiteboard_objects
    DROP COLUMN h,
    DROP COLUMN w,
    DROP COLUMN y,
    DROP COLUMN x,
    DROP COLUMN created_by;
