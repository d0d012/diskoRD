import { useAuthStore } from '../../../stores/authStore';
import { useGuildStore } from '../../../stores/guildStore';

/** Member roles are not cached per guild; without a new fetch, only ownership is known. */
export function useCanManageChannel(channelId?: string, override?: boolean): boolean {
  const guilds = useGuildStore(s => s.guilds);
  const activeGuildId = useGuildStore(s => s.activeGuildId);
  const channels = useGuildStore(s => s.channels);
  const userId = useAuthStore(s => s.user?.id);
  if (override !== undefined) return override;
  const guildId = channelId
    ? Object.values(channels).flat().find(channel => channel.id === channelId)?.guildId
    : activeGuildId;
  return !!userId && guilds.some(guild => guild.id === guildId && guild.ownerId === userId);
}
