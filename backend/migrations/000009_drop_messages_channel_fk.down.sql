ALTER TABLE messages ADD CONSTRAINT messages_channel_id_fkey
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;
