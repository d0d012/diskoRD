-- Reactions used to be stored with the emoji still percent-encoded from the URL
-- path (e.g. '%F0%9F%92%AA' instead of '💪'). Decode those rows in place.
-- Only values made entirely of %XX escapes are touched.

-- Drop encoded rows whose decoded twin already exists for the same user and
-- message, so the UPDATE below cannot violate the primary key.
DELETE FROM message_reactions enc
USING message_reactions dec
WHERE enc.emoji ~ '^(%[0-9A-Fa-f]{2})+$'
  AND dec.message_id = enc.message_id
  AND dec.user_id = enc.user_id
  AND dec.emoji = convert_from(decode(replace(enc.emoji, '%', ''), 'hex'), 'UTF8');

UPDATE message_reactions
SET emoji = convert_from(decode(replace(emoji, '%', ''), 'hex'), 'UTF8')
WHERE emoji ~ '^(%[0-9A-Fa-f]{2})+$';
