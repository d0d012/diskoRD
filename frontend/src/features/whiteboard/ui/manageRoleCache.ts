import { create } from 'zustand';
import { api } from '../../../lib/api';

interface MemberRole { id: string; role: 'owner' | 'admin' | 'moderator' | 'member' }
interface RoleCache { guilds: Record<string, MemberRole[]> }
export const useBoardRoleCache = create<RoleCache>(() => ({ guilds: {} }));
const requests = new Map<string, Promise<void>>();

/** One shared roster request per guild; failed lookups grant no permissions. */
export function loadBoardRoles(guildId: string): Promise<void> {
  const pending = requests.get(guildId);
  if (pending) return pending;
  const request = api.get<{ data: MemberRole[] }>(`/guilds/${guildId}/members`)
    .then(({ data }) => {
      useBoardRoleCache.setState(state => ({ guilds: { ...state.guilds, [guildId]: data.data } }));
    }).catch(() => undefined);
  requests.set(guildId, request);
  return request;
}
