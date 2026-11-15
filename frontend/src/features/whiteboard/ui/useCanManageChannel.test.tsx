import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import { useAuthStore } from '../../../stores/authStore';
import { useGuildStore } from '../../../stores/guildStore';
import { useCanManageChannel } from './useCanManageChannel';

vi.mock('../../../lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../../lib/api')>(),
  api: { get: vi.fn() },
}));

it('shares one roster lookup per guild and grants only owner/admin, recomputing for the current user', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { data: [
    { id: 'admin', role: 'admin' }, { id: 'mod', role: 'moderator' }, { id: 'member', role: 'member' },
  ] } });
  useGuildStore.setState({ activeGuildId: 'gc-guild', guilds: [
    { id: 'gc-guild', ownerId: 'owner' } as never,
  ] });
  useAuthStore.setState({ user: { id: 'admin' } as never });
  const first = renderHook(() => useCanManageChannel());
  const second = renderHook(() => useCanManageChannel());
  expect(first.result.current).toBe(false);
  await waitFor(() => expect(first.result.current).toBe(true));
  expect(second.result.current).toBe(true);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith('/guilds/gc-guild/members');
  for (const id of ['mod', 'member', 'stranger']) {
    act(() => useAuthStore.setState({ user: { id } as never }));
    expect(first.result.current).toBe(false);
  }
  act(() => useAuthStore.setState({ user: { id: 'owner' } as never }));
  expect(first.result.current).toBe(true);
  first.unmount(); second.unmount();
  const reopened = renderHook(() => useCanManageChannel());
  expect(reopened.result.current).toBe(true);
  expect(api.get).toHaveBeenCalledTimes(1);
});
