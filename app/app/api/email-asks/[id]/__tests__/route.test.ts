import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailAsk: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
    },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockFindUnique = prisma.emailAsk.findUnique as Mock;
const mockUpdate = prisma.emailAsk.update as Mock;
const mockTaskFindUnique = prisma.task.findUnique as Mock;

function ask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ask-1',
    message_id: 'msg-1',
    thread_id: null,
    account: 'mike@becomeindelible.com',
    from_name: null,
    from_email: 'client@herba.com',
    subject: 'Site is down',
    gist: 'Client reports site is down',
    queue: 'do',
    severity: 'client_blocking',
    is_urgent: true,
    state: 'open',
    training_note: null,
    task_id: null,
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: new Date('2026-07-21T20:00:00.000Z'),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function req(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/email-asks/ask-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: 'ask-1' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'admin@example.com' });
  mockRequireRole.mockImplementation(() => {});
});

describe('PATCH /api/email-asks/[id]', () => {
  it('marks an ask handled', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockUpdate.mockResolvedValue(ask({ state: 'handled' }));

    const res = await PATCH(req({ state: 'handled' }), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.state).toBe('handled');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'ask-1' },
      data: { state: 'handled', draft_url: null, draft_started_at: null },
    });
  });

  it('dismisses an ask', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockUpdate.mockResolvedValue(ask({ state: 'dismissed' }));

    const res = await PATCH(req({ state: 'dismissed' }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe('dismissed');
  });

  it('sets task_id after verifying the task exists', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockTaskFindUnique.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' });
    mockUpdate.mockResolvedValue(ask({ task_id: '11111111-1111-4111-8111-111111111111' }));

    const res = await PATCH(req({ task_id: '11111111-1111-4111-8111-111111111111' }), ctx());
    expect(res.status).toBe(200);
    expect(mockTaskFindUnique).toHaveBeenCalledWith({
      where: { id: '11111111-1111-4111-8111-111111111111', is_deleted: false },
    });
  });

  it('404s when task_id does not reference an existing task', async () => {
    mockFindUnique.mockResolvedValue(ask());
    mockTaskFindUnique.mockResolvedValue(null);

    const res = await PATCH(req({ task_id: '22222222-2222-4222-8222-222222222222' }), ctx());
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('404s when the ask does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await PATCH(req({ state: 'handled' }), ctx());
    expect(res.status).toBe(404);
  });

  it('rejects an invalid state value', async () => {
    mockFindUnique.mockResolvedValue(ask());
    const res = await PATCH(req({ state: 'archived' }), ctx());
    expect(res.status).toBe(400);
  });

  it('requires admin role (or the Porter lane): a plain pm gets 403', async () => {
    mockRequireAuth.mockResolvedValue({ userId: 'pm-1', role: 'pm', email: 'pm@example.com' });
    const res = await PATCH(req({ state: 'handled' }), ctx());
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  describe('fleet item 6: the Porter lane key (email classifier)', () => {
    const porter = { userId: 'bast', role: 'pm', email: 'bast@example.com', via: 'api_key', apiKeyId: 'k', lane: 'porter' };

    it('may resolve an ask', async () => {
      mockRequireAuth.mockResolvedValue(porter as never);
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask({ state: 'handled' }));
      const res = await PATCH(req({ state: 'handled' }), ctx());
      expect(res.status).toBe(200);
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ state: 'handled' });
      expect((await res.json()).ignored_fields).toBeUndefined();
    });

    it('writes an [auto] note when the stored note is empty', async () => {
      mockRequireAuth.mockResolvedValue(porter as never);
      mockFindUnique.mockResolvedValue(ask({ training_note: null }));
      mockUpdate.mockResolvedValue(ask({ state: 'handled' }));
      const res = await PATCH(req({ state: 'handled', training_note: '[auto] Mike replied in 4m' }), ctx());
      expect(res.status).toBe(200);
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ training_note: '[auto] Mike replied in 4m' });
      expect((await res.json()).ignored_fields).toBeUndefined();
    });

    it('never overwrites a note Mike typed (dropped, ignored_fields)', async () => {
      mockRequireAuth.mockResolvedValue(porter as never);
      mockFindUnique.mockResolvedValue(ask({ training_note: 'Wrong queue: this is a lead' }));
      mockUpdate.mockResolvedValue(ask({ state: 'handled' }));
      const res = await PATCH(req({ state: 'handled', training_note: '[auto] Mike replied' }), ctx());
      expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('training_note');
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ state: 'handled' });
      expect((await res.json()).ignored_fields).toEqual(['training_note']);
    });

    it('never writes a note without the [auto] prefix, nor clears one', async () => {
      mockRequireAuth.mockResolvedValue(porter as never);
      for (const note of ['Looks like a lead', null, '']) {
        mockUpdate.mockClear();
        mockFindUnique.mockResolvedValue(ask({ training_note: null }));
        mockUpdate.mockResolvedValue(ask());
        const res = await PATCH(req({ training_note: note }), ctx());
        expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('training_note');
        expect((await res.json()).ignored_fields).toEqual(['training_note']);
      }
    });

    it('may clear calendar_requested (false) but never set it (true)', async () => {
      mockRequireAuth.mockResolvedValue(porter as never);
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask());
      let res = await PATCH(req({ calendar_requested: false }), ctx());
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ calendar_requested: false });
      expect((await res.json()).ignored_fields).toBeUndefined();
      mockUpdate.mockClear();
      res = await PATCH(req({ calendar_requested: true }), ctx());
      expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty('calendar_requested');
      expect((await res.json()).ignored_fields).toEqual(['calendar_requested']);
    });

    it('may record the executed calendar event (that clears Mike\'s request as before)', async () => {
      mockRequireAuth.mockResolvedValue(porter as never);
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask());
      await PATCH(req({ calendar_event_id: 'evt-1' }), ctx());
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ calendar_event_id: 'evt-1', calendar_requested: false });
    });

    it('no other lane may use it', async () => {
      for (const lane of ['bast', 'courier', 'clarity', 'wright']) {
        mockRequireAuth.mockResolvedValue({ ...porter, lane } as never);
        expect((await PATCH(req({ state: 'handled' }), ctx())).status).toBe(403);
      }
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('an admin still writes training_note', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask());
      await PATCH(req({ training_note: 'Mike typed this' }), ctx());
      expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ training_note: 'Mike typed this' });
    });
  });

  describe('Clarity Phase 4b — archive_requested + training_note', () => {
    it('accepts archive_requested as a valid state (the intake drawer\'s Archive action)', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask({ state: 'archive_requested' }));

      const res = await PATCH(req({ state: 'archive_requested' }), ctx());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.state).toBe('archive_requested');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { state: 'archive_requested', draft_url: null, draft_started_at: null },
      });
    });

    it('sets a training_note', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask({ training_note: 'this was actually noise, not client' }));

      const res = await PATCH(req({ training_note: 'this was actually noise, not client' }), ctx());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.training_note).toBe('this was actually noise, not client');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { training_note: 'this was actually noise, not client' },
      });
    });

    it('clears a training_note when explicitly null', async () => {
      mockFindUnique.mockResolvedValue(ask({ training_note: 'old note' }));
      mockUpdate.mockResolvedValue(ask({ training_note: null }));

      const res = await PATCH(req({ training_note: null }), ctx());
      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { training_note: null },
      });
    });

    it('rejects a training_note over 2000 characters', async () => {
      mockFindUnique.mockResolvedValue(ask());
      const res = await PATCH(req({ training_note: 'x'.repeat(2001) }), ctx());
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Clarity Phase 6 — calendar_requested', () => {
    it('sets calendar_requested=true (the meeting-lane card\'s Add to calendar button)', async () => {
      mockFindUnique.mockResolvedValue(ask({ intent: 'meeting', proposed_event_at: new Date() }));
      mockUpdate.mockResolvedValue(ask({ calendar_requested: true }));

      const res = await PATCH(req({ calendar_requested: true }), ctx());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.calendar_requested).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { calendar_requested: true },
      });
    });

    it('rejects a non-boolean calendar_requested value', async () => {
      mockFindUnique.mockResolvedValue(ask());
      const res = await PATCH(req({ calendar_requested: 'yes' }), ctx());
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('omitting calendar_requested leaves it untouched (not sent to the update call)', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask({ state: 'handled' }));

      await PATCH(req({ state: 'handled' }), ctx());

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { state: 'handled', draft_url: null, draft_started_at: null },
      });
    });
  });

  describe('Clarity Phase 6 addendum — calendar_event_id (the calendar executor\'s completion write)', () => {
    it('sets calendar_event_id and atomically flips calendar_requested to false in the same update', async () => {
      mockFindUnique.mockResolvedValue(ask({ calendar_requested: true }));
      mockUpdate.mockResolvedValue(ask({ calendar_event_id: 'gcal-event-1', calendar_requested: false }));

      const res = await PATCH(req({ calendar_event_id: 'gcal-event-1' }), ctx());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.calendar_event_id).toBe('gcal-event-1');
      expect(body.calendar_requested).toBe(false);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { calendar_event_id: 'gcal-event-1', calendar_requested: false },
      });
    });

    it('calendar_event_id wins over an explicit calendar_requested in the SAME request body', async () => {
      mockFindUnique.mockResolvedValue(ask({ calendar_requested: true }));
      mockUpdate.mockResolvedValue(ask({ calendar_event_id: 'gcal-event-2', calendar_requested: false }));

      await PATCH(req({ calendar_event_id: 'gcal-event-2', calendar_requested: true }), ctx());

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { calendar_requested: false, calendar_event_id: 'gcal-event-2' },
      });
    });

    it('omitting calendar_event_id leaves it (and calendar_requested) untouched', async () => {
      mockFindUnique.mockResolvedValue(ask({ calendar_requested: true }));
      mockUpdate.mockResolvedValue(ask({ state: 'handled', calendar_requested: true }));

      await PATCH(req({ state: 'handled' }), ctx());

      const call = mockUpdate.mock.calls[0][0];
      expect(call.data).not.toHaveProperty('calendar_event_id');
      expect(call.data).not.toHaveProperty('calendar_requested');
    });

    it('explicitly clearing calendar_event_id to null also flips calendar_requested to false', async () => {
      mockFindUnique.mockResolvedValue(ask({ calendar_event_id: 'gcal-old', calendar_requested: false }));
      mockUpdate.mockResolvedValue(ask({ calendar_event_id: null, calendar_requested: false }));

      await PATCH(req({ calendar_event_id: null }), ctx());

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { calendar_event_id: null, calendar_requested: false },
      });
    });

    it('rejects a calendar_event_id over 255 characters', async () => {
      mockFindUnique.mockResolvedValue(ask());
      const res = await PATCH(req({ calendar_event_id: 'x'.repeat(256) }), ctx());
      expect(res.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Clarity Phase 6b — admin intent regression', () => {
    // This route has never validated `intent` at all (it's classifier/email-sync-set
    // only — see app/api/oracle/email-sync/route.ts); these tests confirm the existing
    // PATCH-able fields (state, calendar_requested) still work correctly on a row whose
    // intent is the new 'admin' value, i.e. adding the enum value didn't regress this
    // endpoint's own unrelated behavior.
    it('marks an admin-intent ask handled same as any other lane', async () => {
      mockFindUnique.mockResolvedValue(ask({ intent: 'admin' }));
      mockUpdate.mockResolvedValue(ask({ intent: 'admin', state: 'handled' }));

      const res = await PATCH(req({ state: 'handled' }), ctx());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.state).toBe('handled');
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { state: 'handled', draft_url: null, draft_started_at: null },
      });
    });

    it('sets calendar_requested on an admin-intent ask (no meeting-only restriction at the API layer)', async () => {
      mockFindUnique.mockResolvedValue(ask({ intent: 'admin' }));
      mockUpdate.mockResolvedValue(ask({ intent: 'admin', calendar_requested: true }));

      const res = await PATCH(req({ calendar_requested: true }), ctx());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.calendar_requested).toBe(true);
    });
  });

  describe('Draft-started marker (Mike 2026-10-15)', () => {
    const URL_OK = 'https://mail.google.com/mail/u/?authuser=mike%40becomeindelible.com#all/thread-1';
    const AT = '2026-10-14T15:30:00.000Z';

    it('accepts the pair and stores both (date as a Date)', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask({ draft_started_at: new Date(AT), draft_url: URL_OK }));

      const res = await PATCH(req({ draft_started_at: AT, draft_url: URL_OK }), ctx());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { draft_url: URL_OK, draft_started_at: new Date(AT) },
      });
      expect(body.draft_url).toBe(URL_OK);
    });

    it('accepts an offset timestamp', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask());
      const res = await PATCH(req({ draft_started_at: '2026-10-14T11:30:00-04:00', draft_url: URL_OK }), ctx());
      expect(res.status).toBe(200);
    });

    it('400s for a non-Gmail draft_url', async () => {
      mockFindUnique.mockResolvedValue(ask());
      for (const bad of ['https://evil.example.com/x', 'javascript:alert(1)', 'http://mail.google.com/x', 'https://mail.google.com.evil.com/x']) {
        const res = await PATCH(req({ draft_started_at: AT, draft_url: bad }), ctx());
        expect(res.status).toBe(400);
      }
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('400s for a null half-pair and an https half-pair; 200s for the pair and null/null', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask());
      const nullAlone = await PATCH(req({ draft_started_at: null }), ctx());
      const urlAlone = await PATCH(req({ draft_url: 'https://mail.google.com/mail/u/0/#all/T1' }), ctx());
      const urlNullNull = await PATCH(req({ draft_url: null }), ctx());
      expect(nullAlone.status).toBe(400);
      expect(urlAlone.status).toBe(400);
      expect(urlNullNull.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
      const pair = await PATCH(req({ draft_started_at: AT, draft_url: URL_OK }), ctx());
      const nulls = await PATCH(req({ draft_started_at: null, draft_url: null }), ctx());
      expect(pair.status).toBe(200);
      expect(nulls.status).toBe(200);
    });

    it('400s when only one of the pair is sent', async () => {
      mockFindUnique.mockResolvedValue(ask());
      const onlyUrl = await PATCH(req({ draft_url: URL_OK }), ctx());
      const onlyAt = await PATCH(req({ draft_started_at: AT }), ctx());
      const urlWithNullAt = await PATCH(req({ draft_url: URL_OK, draft_started_at: null }), ctx());
      expect(onlyUrl.status).toBe(400);
      expect(onlyAt.status).toBe(400);
      expect(urlWithNullAt.status).toBe(400);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('null/null clears both', async () => {
      mockFindUnique.mockResolvedValue(ask({ draft_started_at: new Date(AT), draft_url: URL_OK }));
      mockUpdate.mockResolvedValue(ask());

      const res = await PATCH(req({ draft_started_at: null, draft_url: null }), ctx());

      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { draft_url: null, draft_started_at: null },
      });
    });

    it.each(['handled', 'dismissed', 'archive_requested'])(
      'state: %s clears both, even if the same body sends them',
      async (state) => {
        mockFindUnique.mockResolvedValue(ask());
        mockUpdate.mockResolvedValue(ask({ state }));

        await PATCH(req({ state, draft_started_at: AT, draft_url: URL_OK }), ctx());

        expect(mockUpdate).toHaveBeenCalledWith({
          where: { id: 'ask-1' },
          data: { state, draft_url: null, draft_started_at: null },
        });
      },
    );

    it('state: handled alone also clears the stored marker', async () => {
      mockFindUnique.mockResolvedValue(ask({ draft_started_at: new Date(AT), draft_url: URL_OK }));
      mockUpdate.mockResolvedValue(ask({ state: 'handled' }));
      await PATCH(req({ state: 'handled' }), ctx());
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { state: 'handled', draft_url: null, draft_started_at: null },
      });
    });

    it('state: open leaves the marker alone (and does not block setting it)', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask());

      await PATCH(req({ state: 'open' }), ctx());
      expect(mockUpdate).toHaveBeenLastCalledWith({ where: { id: 'ask-1' }, data: { state: 'open' } });

      await PATCH(req({ state: 'open', draft_started_at: AT, draft_url: URL_OK }), ctx());
      expect(mockUpdate).toHaveBeenLastCalledWith({
        where: { id: 'ask-1' },
        data: { state: 'open', draft_url: URL_OK, draft_started_at: new Date(AT) },
      });
    });

    it('omitting both leaves the marker untouched', async () => {
      mockFindUnique.mockResolvedValue(ask());
      mockUpdate.mockResolvedValue(ask());
      await PATCH(req({ training_note: 'x' }), ctx());
      expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'ask-1' }, data: { training_note: 'x' } });
    });
  });
});
