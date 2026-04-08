ALTER TABLE guild_members
  ADD CONSTRAINT guild_member_role_check
  CHECK (role IN ('owner','admin','moderator','member'));
