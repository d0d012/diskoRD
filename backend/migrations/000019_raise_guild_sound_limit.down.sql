-- Restoring the 5-second bound fails while longer sounds exist; delete them first.
ALTER TABLE guild_sounds DROP CONSTRAINT guild_sounds_audio_check;
ALTER TABLE guild_sounds
    ADD CONSTRAINT guild_sounds_audio_check CHECK (octet_length(audio) BETWEEN 46 AND 240044);
