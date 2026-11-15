BEGIN;

ALTER TABLE whiteboards
    ADD COLUMN object_count INTEGER NOT NULL DEFAULT 0 CHECK (object_count >= 0),
    ADD COLUMN body_bytes BIGINT NOT NULL DEFAULT 0 CHECK (body_bytes >= -1);

-- Count is exact in SQL. JSONB text is NOT Go's canonical compact encoding:
-- whitespace, float64 number spelling and HTML escaping differ. Mark nonempty
-- boards unknown (-1); the first successful command recomputes exact bytes
-- with canonicalStoredBody under the board row lock, then persists both counters.
-- Empty and newly created boards already have exact zero counters.
UPDATE whiteboards AS b
SET object_count = totals.object_count, body_bytes = -1
FROM (
    SELECT board_id, count(*) AS object_count
    FROM whiteboard_objects
    GROUP BY board_id
) AS totals
WHERE b.id = totals.board_id;

COMMIT;
