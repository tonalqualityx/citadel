import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    arc: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    accord: {
      findUnique: vi.fn(),
    },
    oracleSession: {
      findFirst: vi.fn(),
    },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockArcFindUnique = prisma.arc.findUnique as Mock;
const mockArcUpdate = prisma.arc.update as Mock;
const mockClientFindUnique = prisma.client.findUnique as Mock;
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockAccordFindUnique = prisma.accord.findUnique as Mock;
const mockOracleSessionFindFirst = prisma.oracleSession.findFirst as Mock;

function arc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'arc-1',
    name: 'Arc name',
    description: null,
    client_id: null,
    client: null,
    project_id: null,
    project: null,
    accord_id: null,
    accord: null,
    origin_session_external_id: null,
    closed_at: null,
    estimate_override_minutes: null,
    next_touch: null,
    cover_url: null,
    created_at: new Date(),
    updated_at: new Date(),
    tasks: [],
    sessions: [],
    email_asks: [],
    today_picks: [],
    ...overrides,
  };
}

function getRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/arcs/arc-1');
}

function patchRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/arcs/arc-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const params = Promise.resolve({ id: 'arc-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'pm', email: 'pm@example.com' });
});

describe('GET /api/arcs/[id]', () => {
  it('returns the arc with its tasks and derived status', async () => {
    mockArcFindUnique.mockResolvedValue(
      arc({ tasks: [{ id: 't1', title: 'Task 1', status: 'in_progress', priority: 2, due_date: null, assignee_id: null, assignee: null }] })
    );

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('open');
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe('Task 1');
  });

  it('404s when the arc does not exist', async () => {
    mockArcFindUnique.mockResolvedValue(null);
    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Arc not found');
  });

  // Clarity Phase 4c — the arc board header's time estimate.
  it('computes estimated_minutes_total from OPEN tasks only, treating a null estimate as 0', async () => {
    mockArcFindUnique.mockResolvedValue(
      arc({
        tasks: [
          { id: 't1', title: 'Open A', status: 'not_started', priority: 2, due_date: null, assignee_id: null, assignee: null, estimated_minutes: 30 },
          { id: 't2', title: 'Open B (no estimate)', status: 'in_progress', priority: 1, due_date: null, assignee_id: null, assignee: null, estimated_minutes: null },
          { id: 't3', title: 'Done (excluded)', status: 'done', priority: 3, due_date: null, assignee_id: null, assignee: null, estimated_minutes: 500 },
        ],
      })
    );

    const res = await GET(getRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.estimated_minutes_total).toBe(30);
  });

  it('null estimate_override_minutes passes through as-is', async () => {
    mockArcFindUnique.mockResolvedValue(arc({ estimate_override_minutes: null }));
    const res = await GET(getRequest(), { params });
    const body = await res.json();
    expect(body.estimate_override_minutes).toBeNull();
  });

  it('a set estimate_override_minutes passes through', async () => {
    mockArcFindUnique.mockResolvedValue(arc({ estimate_override_minutes: 120 }));
    const res = await GET(getRequest(), { params });
    const body = await res.json();
    expect(body.estimate_override_minutes).toBe(120);
  });

  // Clarity Phase 4c — the arc board header's session panel.
  describe('sessions', () => {
    it('returns the arc_id-linked sessions when there is no origin_session_external_id', async () => {
      const linkedSession = {
        id: 'sess-1',
        external_id: 'ext-1',
        title: 'Linked session',
        status: 'running',
        remote_url: null,
        needs_attention: false,
        last_event_at: null,
      };
      mockArcFindUnique.mockResolvedValue(arc({ sessions: [linkedSession] }));

      const res = await GET(getRequest(), { params });
      const body = await res.json();

      expect(body.sessions).toEqual([linkedSession]);
      expect(mockOracleSessionFindFirst).not.toHaveBeenCalled();
    });

    it('renders nothing (empty array) when the arc has no linked sessions at all', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ sessions: [] }));

      const res = await GET(getRequest(), { params });
      const body = await res.json();

      expect(body.sessions).toEqual([]);
    });

    it('looks up and merges the origin session when it is not already arc_id-linked', async () => {
      mockArcFindUnique.mockResolvedValue(
        arc({ origin_session_external_id: 'ext-origin', sessions: [] })
      );
      const originSession = {
        id: 'sess-origin',
        external_id: 'ext-origin',
        title: 'Origin session',
        status: 'idle',
        remote_url: null,
        needs_attention: false,
        last_event_at: null,
      };
      mockOracleSessionFindFirst.mockResolvedValue(originSession);

      const res = await GET(getRequest(), { params });
      const body = await res.json();

      expect(mockOracleSessionFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { external_id: 'ext-origin' } })
      );
      expect(body.sessions).toEqual([originSession]);
    });

    it('does not re-query when the origin session is already among the arc_id-linked set', async () => {
      const linkedSession = {
        id: 'sess-shared',
        external_id: 'ext-shared',
        title: 'Shared session',
        status: 'waiting',
        remote_url: null,
        needs_attention: true,
        last_event_at: new Date().toISOString(),
      };
      mockArcFindUnique.mockResolvedValue(
        arc({ origin_session_external_id: 'ext-shared', sessions: [linkedSession] })
      );

      const res = await GET(getRequest(), { params });
      const body = await res.json();

      expect(mockOracleSessionFindFirst).not.toHaveBeenCalled();
      expect(body.sessions).toEqual([linkedSession]);
    });
  });

  // Clarity Phase 7 — Seeing Stone Reckoning P1: accord summary, attached emails, picks.
  describe('Clarity Phase 7 — accord/email_asks/today_picks', () => {
    it('includes the accord summary (status + lead contact fields) when the arc is linked to one', async () => {
      mockArcFindUnique.mockResolvedValue(
        arc({
          accord_id: 'accord-1',
          accord: {
            id: 'accord-1',
            name: 'Herba pipeline',
            status: 'proposal',
            lead_name: 'Jane Doe',
            lead_business_name: 'Herba Co',
            lead_email: 'jane@herba.com',
            lead_phone: null,
          },
        })
      );

      const res = await GET(getRequest(), { params });
      const body = await res.json();

      expect(body.accord_id).toBe('accord-1');
      expect(body.accord).toEqual({
        id: 'accord-1',
        name: 'Herba pipeline',
        status: 'proposal',
        lead_name: 'Jane Doe',
        lead_business_name: 'Herba Co',
        lead_email: 'jane@herba.com',
        lead_phone: null,
      });
    });

    it('accord is null when the arc has no accord link', async () => {
      mockArcFindUnique.mockResolvedValue(arc());
      const res = await GET(getRequest(), { params });
      const body = await res.json();

      expect(body.accord_id).toBeNull();
      expect(body.accord).toBeNull();
    });

    it('includes attached email_asks', async () => {
      mockArcFindUnique.mockResolvedValue(
        arc({
          email_asks: [
            {
              id: 'ask-1',
              subject: 'Re: proposal',
              from_email: 'jane@herba.com',
              from_name: 'Jane',
              gist: 'Wants a call this week',
              deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
              received_at: new Date('2026-07-20T00:00:00.000Z'),
              thread_id: 'thread-1',
            },
          ],
        })
      );

      const res = await GET(getRequest(), { params });
      const body = await res.json();

      expect(body.email_asks).toEqual([
        {
          id: 'ask-1',
          subject: 'Re: proposal',
          from_email: 'jane@herba.com',
          from_name: 'Jane',
          gist: 'Wants a call this week',
          deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
          received_at: new Date('2026-07-20T00:00:00.000Z').toISOString(),
        },
      ]);
    });

    it('includes today_picks', async () => {
      const pickRow = {
        id: 'pick-1',
        date: new Date('2026-07-27T00:00:00.000Z'),
        item_type: 'arc',
        label: null,
        sort: 0,
        started_at: null,
        completed_at: null,
        calendar_event_id: null,
      };
      mockArcFindUnique.mockResolvedValue(arc({ today_picks: [pickRow] }));

      const res = await GET(getRequest(), { params });
      const body = await res.json();

      expect(body.today_picks).toHaveLength(1);
      expect(body.today_picks[0].id).toBe('pick-1');
    });

    it('next_touch and cover_url pass through', async () => {
      const nextTouch = new Date('2026-08-01T00:00:00.000Z');
      mockArcFindUnique.mockResolvedValue(arc({ next_touch: nextTouch, cover_url: 'https://example.com/cover.jpg' }));

      const res = await GET(getRequest(), { params });
      const body = await res.json();

      expect(body.next_touch).toBe(nextTouch.toISOString());
      expect(body.cover_url).toBe('https://example.com/cover.jpg');
    });
  });
});

describe('PATCH /api/arcs/[id]', () => {
  beforeEach(() => {
    mockArcFindUnique.mockResolvedValue(arc());
  });

  it('updates name and description', async () => {
    mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed', description: 'New desc' }));

    const res = await PATCH(patchRequest({ name: 'Renamed', description: 'New desc' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Renamed');
    expect(mockArcUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Renamed', description: 'New desc' }),
      })
    );
  });

  it('404s when the arc does not exist', async () => {
    mockArcFindUnique.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ name: 'X' }), { params });
    expect(res.status).toBe(404);
  });

  it('setting closed_at closes the thread (status becomes complete even with open tasks)', async () => {
    const closedAt = new Date().toISOString();
    mockArcUpdate.mockResolvedValue(
      arc({ closed_at: new Date(closedAt), tasks: [{ id: 't1', title: 'T', status: 'not_started', priority: 3, due_date: null, assignee_id: null, assignee: null }] })
    );

    const res = await PATCH(patchRequest({ closed_at: closedAt }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('complete');
    expect(mockArcUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ closed_at: expect.any(Date) }) })
    );
  });

  it('setting closed_at to null reopens the arc', async () => {
    mockArcFindUnique.mockResolvedValue(arc({ closed_at: new Date() }));
    mockArcUpdate.mockResolvedValue(
      arc({ closed_at: null, tasks: [{ id: 't1', title: 'T', status: 'not_started', priority: 3, due_date: null, assignee_id: null, assignee: null }] })
    );

    const res = await PATCH(patchRequest({ closed_at: null }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('open');
    expect(mockArcUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ closed_at: null }) })
    );
  });

  it('leaves closed_at untouched when absent from the body', async () => {
    mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed' }));

    await PATCH(patchRequest({ name: 'Renamed' }), { params });

    const callArgs = mockArcUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect('closed_at' in callArgs.data).toBe(false);
  });

  it('rejects an invalid client_id (validation failure, not a UUID)', async () => {
    const res = await PATCH(patchRequest({ client_id: 'not-a-uuid' }), { params });
    expect(res.status).toBe(400);
  });

  it('404s when client_id does not exist', async () => {
    mockClientFindUnique.mockResolvedValue(null);
    const res = await PATCH(
      patchRequest({ client_id: '550e8400-e29b-41d4-a716-446655440000' }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Client not found');
  });

  it('404s when project_id does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await PATCH(
      patchRequest({ project_id: '550e8400-e29b-41d4-a716-446655440001' }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Project not found');
  });

  // Clarity Phase 5 — the Soothsayer's snooze action.
  describe('snoozed_until', () => {
    it('sets snoozed_until', async () => {
      const until = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      mockArcUpdate.mockResolvedValue(arc({ snoozed_until: new Date(until) }));

      const res = await PATCH(patchRequest({ snoozed_until: until }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.snoozed_until).toBe(new Date(until).toISOString());
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ snoozed_until: expect.any(Date) }) })
      );
    });

    it('setting snoozed_until to null un-snoozes', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ snoozed_until: new Date() }));
      mockArcUpdate.mockResolvedValue(arc({ snoozed_until: null }));

      const res = await PATCH(patchRequest({ snoozed_until: null }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.snoozed_until).toBeNull();
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ snoozed_until: null }) })
      );
    });

    it('leaves snoozed_until untouched when absent from the body', async () => {
      mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed' }));

      await PATCH(patchRequest({ name: 'Renamed' }), { params });

      const callArgs = mockArcUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect('snoozed_until' in callArgs.data).toBe(false);
    });

    it('rejects an invalid snoozed_until (not ISO-8601)', async () => {
      const res = await PATCH(patchRequest({ snoozed_until: 'not-a-date' }), { params });
      expect(res.status).toBe(400);
    });
  });

  // Clarity Phase 4c — the arc board header's time-estimate override.
  describe('estimate_override_minutes', () => {
    it('sets estimate_override_minutes', async () => {
      mockArcUpdate.mockResolvedValue(arc({ estimate_override_minutes: 90 }));

      const res = await PATCH(patchRequest({ estimate_override_minutes: 90 }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.estimate_override_minutes).toBe(90);
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ estimate_override_minutes: 90 }) })
      );
    });

    it('setting estimate_override_minutes to null clears the override', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ estimate_override_minutes: 90 }));
      mockArcUpdate.mockResolvedValue(arc({ estimate_override_minutes: null }));

      const res = await PATCH(patchRequest({ estimate_override_minutes: null }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.estimate_override_minutes).toBeNull();
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ estimate_override_minutes: null }) })
      );
    });

    it('leaves estimate_override_minutes untouched when absent from the body', async () => {
      mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed' }));

      await PATCH(patchRequest({ name: 'Renamed' }), { params });

      const callArgs = mockArcUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect('estimate_override_minutes' in callArgs.data).toBe(false);
    });

    it('rejects a negative estimate_override_minutes', async () => {
      const res = await PATCH(patchRequest({ estimate_override_minutes: -5 }), { params });
      expect(res.status).toBe(400);
    });

    it('rejects a non-integer estimate_override_minutes', async () => {
      const res = await PATCH(patchRequest({ estimate_override_minutes: 12.5 }), { params });
      expect(res.status).toBe(400);
    });
  });

  // Clarity Phase 7 — the anti-drop-net "act by" date.
  describe('next_touch', () => {
    it('sets next_touch', async () => {
      const touch = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      mockArcUpdate.mockResolvedValue(arc({ next_touch: new Date(touch) }));

      const res = await PATCH(patchRequest({ next_touch: touch }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.next_touch).toBe(new Date(touch).toISOString());
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ next_touch: expect.any(Date) }) })
      );
    });

    it('setting next_touch to null clears it', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ next_touch: new Date() }));
      mockArcUpdate.mockResolvedValue(arc({ next_touch: null }));

      const res = await PATCH(patchRequest({ next_touch: null }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.next_touch).toBeNull();
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ next_touch: null }) })
      );
    });

    it('leaves next_touch untouched when absent from the body', async () => {
      mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed' }));
      await PATCH(patchRequest({ name: 'Renamed' }), { params });

      const callArgs = mockArcUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect('next_touch' in callArgs.data).toBe(false);
    });

    it('rejects an invalid next_touch (not ISO-8601)', async () => {
      const res = await PATCH(patchRequest({ next_touch: 'not-a-date' }), { params });
      expect(res.status).toBe(400);
    });
  });

  // Clarity Phase 7 — the sales-pipeline link.
  describe('accord_id', () => {
    const ACCORD_UUID = '550e8400-e29b-41d4-a716-446655440010';

    it('attaches a valid accord', async () => {
      mockAccordFindUnique.mockResolvedValue({ id: ACCORD_UUID });
      mockArcUpdate.mockResolvedValue(arc({ accord_id: ACCORD_UUID, accord: { id: ACCORD_UUID, name: 'Herba', status: 'lead', lead_name: null, lead_business_name: null, lead_email: null, lead_phone: null } }));

      const res = await PATCH(patchRequest({ accord_id: ACCORD_UUID }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.accord_id).toBe(ACCORD_UUID);
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ accord_id: ACCORD_UUID }) })
      );
    });

    it('404s when accord_id does not exist', async () => {
      mockAccordFindUnique.mockResolvedValue(null);
      const res = await PATCH(patchRequest({ accord_id: ACCORD_UUID }), { params });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe('Accord not found');
    });

    it('detaches an accord when accord_id is explicitly null', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ accord_id: 'accord-1' }));
      mockArcUpdate.mockResolvedValue(arc({ accord_id: null, accord: null }));

      const res = await PATCH(patchRequest({ accord_id: null }), { params });
      expect(res.status).toBe(200);
      expect(mockAccordFindUnique).not.toHaveBeenCalled();
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ accord_id: null }) })
      );
    });

    it('leaves accord_id untouched when absent from the body', async () => {
      mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed' }));
      await PATCH(patchRequest({ name: 'Renamed' }), { params });

      const callArgs = mockArcUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect('accord_id' in callArgs.data).toBe(false);
    });
  });

  // Clarity Phase 7 — the arc board card's cover image.
  describe('cover_url', () => {
    it('sets cover_url', async () => {
      mockArcUpdate.mockResolvedValue(arc({ cover_url: 'https://example.com/cover.jpg' }));

      const res = await PATCH(patchRequest({ cover_url: 'https://example.com/cover.jpg' }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.cover_url).toBe('https://example.com/cover.jpg');
    });

    it('clears cover_url when explicitly null', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ cover_url: 'https://example.com/old.jpg' }));
      mockArcUpdate.mockResolvedValue(arc({ cover_url: null }));

      const res = await PATCH(patchRequest({ cover_url: null }), { params });
      expect(res.status).toBe(200);
      expect(mockArcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cover_url: null }) })
      );
    });

    it('leaves cover_url untouched when absent from the body', async () => {
      mockArcUpdate.mockResolvedValue(arc({ name: 'Renamed' }));
      await PATCH(patchRequest({ name: 'Renamed' }), { params });

      const callArgs = mockArcUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect('cover_url' in callArgs.data).toBe(false);
    });
  });

  // Clarity Phase 7 — the completion-nudge hook on arc close.
  describe('completion_nudge on arc close', () => {
    it('includes completion_nudge when closing an arc that has an attached email', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ closed_at: null }));
      mockArcUpdate.mockResolvedValue(
        arc({
          closed_at: new Date(),
          email_asks: [
            {
              id: 'ask-1',
              subject: 'Re: proposal',
              from_email: 'jane@herba.com',
              from_name: 'Jane',
              gist: null,
              deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
              received_at: new Date(),
              thread_id: 'thread-1',
            },
          ],
        })
      );

      const res = await PATCH(patchRequest({ closed_at: new Date().toISOString() }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.completion_nudge).toEqual({
        thread_id: 'thread-1',
        subject: 'Re: proposal',
        from_email: 'jane@herba.com',
      });
    });

    it('omits completion_nudge when closing an arc with no attached emails', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ closed_at: null }));
      mockArcUpdate.mockResolvedValue(arc({ closed_at: new Date(), email_asks: [] }));

      const res = await PATCH(patchRequest({ closed_at: new Date().toISOString() }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.completion_nudge).toBeUndefined();
    });

    it('omits completion_nudge when the arc was ALREADY closed (not a new transition)', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ closed_at: new Date('2026-01-01T00:00:00.000Z') }));
      mockArcUpdate.mockResolvedValue(
        arc({
          closed_at: new Date('2026-01-01T00:00:00.000Z'),
          name: 'Renamed',
          email_asks: [
            {
              id: 'ask-1',
              subject: 'Re: proposal',
              from_email: 'jane@herba.com',
              from_name: null,
              gist: null,
              deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
              received_at: new Date(),
              thread_id: 'thread-1',
            },
          ],
        })
      );

      const res = await PATCH(patchRequest({ name: 'Renamed' }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.completion_nudge).toBeUndefined();
    });

    it('omits completion_nudge when reopening an arc (closed_at set to null)', async () => {
      mockArcFindUnique.mockResolvedValue(arc({ closed_at: new Date() }));
      mockArcUpdate.mockResolvedValue(arc({ closed_at: null, email_asks: [{ id: 'ask-1', subject: 'X', from_email: 'a@b.com', from_name: null, gist: null, deep_link: 'https://x', received_at: new Date(), thread_id: null }] }));

      const res = await PATCH(patchRequest({ closed_at: null }), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.completion_nudge).toBeUndefined();
    });
  });
});
