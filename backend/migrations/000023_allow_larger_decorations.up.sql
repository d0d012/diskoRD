ALTER TABLE message_decorations DROP CONSTRAINT message_decorations_size_check;
ALTER TABLE message_decorations ADD CONSTRAINT message_decorations_size_check
    CHECK (size IN (32, 48, 64, 96, 128, 192, 256));
