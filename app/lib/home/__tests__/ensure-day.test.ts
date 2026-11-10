/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getHomeDay: vi.fn(),
  getOrCreateHomeDay: vi.fn(),
  loadItemStates: vi.fn(),
  loadHomeInputs: vi.fn(),
  selectHome: vi.fn(),
  proposeDay: vi.fn(),
}));
vi.mock('../state', () => ({ getHomeDay: h.getHomeDay, getOrCreateHomeDay: h.getOrCreateHomeDay, loadItemStates: h.loadItemStates }));
vi.mock('../load', () => ({ loadHomeInputs: h.loadHomeInputs }));
vi.mock('../select', () => ({ selectHome: h.selectHome }));
vi.mock('../today', async (orig) => ({ ...(await orig<typeof import('../today')>()), proposeDay: h.proposeDay }));

import { ensureHomeDay } from '../ensure-day';

const NOW = new Date('2026-11-10T05:30:00Z'); // 00:30 on the 10th in New York
const proposal = { group_key: 'arc:1', group_label: 'Grok', arc_id: null, quick_item_keys: ['task:a'], step_item_keys: ['task:b'], sized_minutes: 30 };

beforeEach(() => {
  vi.clearAllMocks();
  h.getHomeDay.mockResolvedValue(null);
  h.loadHomeInputs.mockResolvedValue({ calendar_events: [] });
  h.loadItemStates.mockResolvedValue(new Map());
  h.selectHome.mockReturnValue({ candidates: [] });
  h.proposeDay.mockReturnValue(proposal);
  h.getOrCreateHomeDay.mockImplementation(async (_db: any, _u: string, _d: string, build: () => unknown) => ({ day: build(), created: true }));
});

describe('ensureHomeDay', () => {
  it('stores the day\'s proposal under the owner\'s local date when none exists', async () => {
    const date = await ensureHomeDay({} as any, 'u1', NOW, 'America/New_York');
    expect(date).toBe('2026-11-10');
    expect(h.getOrCreateHomeDay).toHaveBeenCalledTimes(1);
    expect(h.getOrCreateHomeDay.mock.calls[0].slice(1, 3)).toEqual(['u1', '2026-11-10']);
    expect(h.getOrCreateHomeDay.mock.calls[0][3]()).toEqual(proposal);
  });
  it('leaves an existing day alone and does not load anything', async () => {
    h.getHomeDay.mockResolvedValue({ group_key: 'arc:1' });
    expect(await ensureHomeDay({} as any, 'u1', NOW, 'America/New_York')).toBe('2026-11-10');
    expect(h.loadHomeInputs).not.toHaveBeenCalled();
    expect(h.getOrCreateHomeDay).not.toHaveBeenCalled();
  });
  it('writes nothing and returns null when nothing is in view', async () => {
    h.proposeDay.mockReturnValue(null);
    expect(await ensureHomeDay({} as any, 'u1', NOW, 'America/New_York')).toBeNull();
    expect(h.getOrCreateHomeDay).not.toHaveBeenCalled();
  });
});
