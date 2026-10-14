-- Guild sounds may be up to 15 seconds: mono PCM16 at 24 kHz = 720000 bytes plus
-- the 44-byte WAV header (was 5 seconds / 240044 bytes).
ALTER TABLE guild_sounds DROP CONSTRAINT guild_sounds_audio_check;
ALTER TABLE guild_sounds
    ADD CONSTRAINT guild_sounds_audio_check CHECK (octet_length(audio) BETWEEN 46 AND 720044);
