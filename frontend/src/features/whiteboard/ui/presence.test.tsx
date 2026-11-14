import { Profiler } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakePresenceAdapter, participant } from '../render/overlays/presenceTestUtils';
import { Participants } from './Participants';
import { SyncStatusChip } from './SyncStatus';

afterEach(cleanup);

describe('Participants', () => {
  it('shows self first, five initials and +N overflow, with names and palette rings', () => {
    const people = Array.from({ length: 8 }, (_, i) => participant({ userId: `u${i}`, name: `Person ${i}`, colourIndex: i }));
    const fake = fakePresenceAdapter(people);
    const v = render(<Participants adapter={fake.adapter} selfUserId="u7" />);
    const avatars = v.container.querySelectorAll<HTMLElement>('.wb-presence-avatar');
    expect(avatars).toHaveLength(5);
    expect(avatars[0]).toHaveAttribute('title', 'Person 7 (you)');
    expect(avatars[0].style.getPropertyValue('--wb-cursor-color')).toBe('var(--wb-colour-purple)');
    expect(avatars[0]).toHaveTextContent('P');
    expect(v.getByText('+3')).toHaveAttribute('title', 'Person 4, Person 5, Person 6');
  });

  it('updates for joins/leaves but not pointer/drag samples', () => {
    const fake = fakePresenceAdapter([participant()]);
    const rendered = vi.fn();
    const v = render(<Profiler id="participants" onRender={rendered}><Participants adapter={fake.adapter} selfUserId="self" /></Profiler>);
    const count = rendered.mock.calls.length;
    act(() => fake.emit([participant({ cursor: { x: 500, y: 300 }, drag: { ids: ['a'], dx: 5, dy: 10 } })]));
    expect(rendered).toHaveBeenCalledTimes(count);
    act(() => fake.emit([participant(), participant({ userId: 'r2', name: 'Grace' })]));
    expect(v.getByLabelText('Grace')).toBeInTheDocument();
    const joinedCount = rendered.mock.calls.length;
    act(() => fake.emit([participant({ userId: 'r2', name: 'Grace' }), participant()]));
    expect(rendered).toHaveBeenCalledTimes(joinedCount); // adapter ordering is not a membership change
    act(() => fake.emit([]));
    expect(v.queryByLabelText('Grace')).toBeNull();
    expect(v.container.querySelectorAll('.wb-presence-avatar')).toHaveLength(0);
    v.unmount();
    expect(fake.listenerCount()).toBe(0);
  });
});

describe('SyncStatusChip', () => {
  it('stays empty when live and politely announces all other statuses', () => {
    const fake = fakePresenceAdapter();
    const v = render(<SyncStatusChip adapter={fake.adapter} />);
    const chip = v.getByRole('status');
    expect(chip).toBeEmptyDOMElement();
    expect(chip).toHaveAttribute('aria-live', 'polite');
    act(() => fake.status('connecting'));
    expect(chip).toHaveTextContent('Connecting…');
    act(() => fake.status('resyncing'));
    expect(chip).toHaveTextContent('Reconnecting…');
    act(() => fake.status('offline'));
    expect(chip).toHaveTextContent("Offline — changes will sync when you're back");
    act(() => fake.status('live'));
    expect(chip).toBeEmptyDOMElement();
    v.unmount();
    expect(fake.listenerCount()).toBe(0);
  });
});
