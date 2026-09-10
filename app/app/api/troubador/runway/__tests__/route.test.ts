import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/services/troubador-runway', () => ({
  getRunwayReport: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { AuthError } from '@/lib/api/errors';
import { getRunwayReport } from '@/lib/services/troubador-runway';

const mockRequireAuth = vi.mocked(requireAuth);
const mockReport = getRunwayReport as Mock;

const dry = {
  site_id: 'site-1',
  site_name: 'botanicaldream.com',
  client_id: 'client-1',
  client_name: 'Herba',
  shelf_count: 0,
  unscheduled_count: 0,
  postponed_count: 7,
  publish_per_week: 1,
  cadence_source: 'schedule',
  lead_time_days: 14,
  runway_days: 0,
  runway_end: '2026-09-10',
  scheduled_through: null,
  trigger_days: 21,
  low_runway: true,
  has_live_run: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'u1', role: 'pm', email: 'mike@becomeindelible.com' });
});

describe('GET /api/troubador/runway', () => {
  it('returns every watched site with the low-runway count', async () => {
    mockReport.mockResolvedValue({
      generated_at: '2026-09-10T12:00:00.000Z',
      sites: [dry],
      alarms: [{ runway: dry, meeting_request_draft: { to_client: { subject: 's', body: 'b' }, to_mike: 'm', booking_url: 'https://x', book_by_date: '2026-08-27' } }],
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sites).toHaveLength(1);
    expect(body.low_runway_count).toBe(1);
    expect(body.alarms[0].meeting_request_draft.to_client.subject).toBe('s');
  });

  it('reports a clean pipeline as zero alarms rather than an error', async () => {
    mockReport.mockResolvedValue({
      generated_at: '2026-09-10T12:00:00.000Z',
      sites: [{ ...dry, shelf_count: 10, runway_days: 70, low_runway: false }],
      alarms: [],
    });
    const body = await (await GET()).json();
    expect(body.low_runway_count).toBe(0);
    expect(body.alarms).toEqual([]);
  });

  it('requires authentication', async () => {
    mockRequireAuth.mockRejectedValue(new AuthError('Unauthorized'));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockReport).not.toHaveBeenCalled();
  });
});
