ALTER TABLE whiteboard_objects
    ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN x DOUBLE PRECISION,
    ADD COLUMN y DOUBLE PRECISION,
    ADD COLUMN w DOUBLE PRECISION,
    ADD COLUMN h DOUBLE PRECISION;

UPDATE whiteboard_objects o
SET created_by = u.id
FROM users u
WHERE u.id::text = o.body->>'createdBy';

UPDATE whiteboard_objects
SET x = (body->>'x')::DOUBLE PRECISION,
    y = (body->>'y')::DOUBLE PRECISION,
    w = (body->>'w')::DOUBLE PRECISION,
    h = (body->>'h')::DOUBLE PRECISION;

ALTER TABLE whiteboard_objects
    ALTER COLUMN x SET NOT NULL,
    ALTER COLUMN y SET NOT NULL,
    ALTER COLUMN w SET NOT NULL,
    ALTER COLUMN h SET NOT NULL;

CREATE INDEX idx_whiteboard_objects_board_author ON whiteboard_objects (board_id, created_by);
CREATE INDEX idx_whiteboard_objects_author ON whiteboard_objects (created_by);
