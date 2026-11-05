ALTER TABLE messages ADD COLUMN reply_to UUID REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX idx_messages_reply_to ON messages(reply_to);
