import { useEffect } from 'react';
import { loadBoardRoles, useBoardRoleCache } from './manageRoleCache';
import { useAuthStore } from '../../../stores/authStore';
import { useGuildStore } from '../../../stores/guildStore';

/** The server remains authoritative if cached membership permissions change. */
export function useCanManageChannel(channelId?: string, override?: boolean): boolean {
  const guilds = useGuildStore(s => s.guilds);
  const activeGuildId = useGuildStore(s => s.activeGuildId);
  const channels = useGuildStore(s => s.channels);
  const userId = useAuthStore(s => s.user?.id);
  const guildId = channelId
    ? Object.values(channels).flat().find(channel => channel.id === channelId)?.guildId
    : activeGuildId;
  const members = useBoardRoleCache(s => guildId ? s.guilds[guildId] : undefined);
  useEffect(() => {
    if (guildId && override === undefined) void loadBoardRoles(guildId);
  }, [guildId, override]);
  if (override !== undefined) return override;
  return !!userId && (guilds.some(guild => guild.id === guildId && guild.ownerId === userId)
    || members?.some(member => member.id === userId && (member.role === 'admin' || member.role === 'owner')) === true);
}
