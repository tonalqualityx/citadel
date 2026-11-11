import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailAsk: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    // Work stage B: the home owner check (no owner = nothing about intake decisions is stored).
    bastChatSettings: {
      findUnique: vi.fn(),
    },
    // Oracle Projects Tab Phase 2 — the client/project auto-matcher's own queries.
    clientContact: {
      findMany: vi.fn(),
    },
    project: {
      findMany: vi.fn(),
    },
  },
}));

const waitStore = vi.hoisted(() => ({ insertIdempotent: vi.fn(), addEvent: vi.fn() }));
vi.mock('@/lib/waits/prisma-store', () => ({ prismaSweepStore: () => waitStore }));

vi.mock('@/lib/services/notifications', () => ({
  notifyUrgentEmail: vi.fn(),
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { notifyUrgentEmail } from '@/lib/services/notifications';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindUnique = prisma.emailAsk.findUnique as Mock;
const mockUpsert = prisma.emailAsk.upsert as Mock;
const mockEmailAskUpdate = prisma.emailAsk.update as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockClientContactFindMany = prisma.clientContact.findMany as Mock;
const mockProjectFindMany = prisma.project.findMany as Mock;
const mockNotifyUrgentEmail = vi.mocked(notifyUrgentEmail);
const mockSettings = prisma.bastChatSettings.findUnique as Mock;

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/oracle/email-sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
  });
}

function baseAsk(overrides: Record<string, unknown> = {}) {
  return {
    message_id: 'msg-1',
    account: 'mike@becomeindelible.com',
    from_email: 'client@herba.com',
    subject: 'Site is down',
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: '2026-07-21T20:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-123', role: 'admin', email: 'mike@becomeindelible.com' });
  mockFindUnique.mockResolvedValue(null);
  mockUpsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
    Promise.resolve({ id: 'ask-1', ...create })
  );
  mockUserFindUnique.mockResolvedValue({ id: 'operator-1', email: 'mike@becomeindelible.com' });
  mockSettings.mockResolvedValue(null);
  // Oracle Projects Tab Phase 2 — default: no contact resolves for the sender, so the
  // auto-matcher is a no-op for every pre-existing test above (it returns immediately
  // once clientContact.findMany comes back empty, never reaching project.findMany or
  // emailAsk.update).
  mockClientContactFindMany.mockResolvedValue([]);
  mockProjectFindMany.mockResolvedValue([]);
});

describe('POST /api/oracle/email-sync', () => {
  it('upserts a non-urgent ask and does not notify', async () => {
    const res = await POST(postRequest({ asks: [baseAsk()] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);
    expect(body.created).toBe(1);
    expect(body.notified_urgent).toBe(0);
    expect(mockNotifyUrgentEmail).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { message_id: 'msg-1' },
        create: expect.objectContaining({ subject: 'Site is down', is_urgent: false }),
      })
    );
  });

  it('notifies the primary operator when a NEW ask is urgent', async () => {
    mockUpsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'ask-urgent-1', ...create })
    );

    const res = await POST(postRequest({ asks: [baseAsk({ is_urgent: true, message_id: 'msg-urgent' })] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notified_urgent).toBe(1);
    expect(mockNotifyUrgentEmail).toHaveBeenCalledWith(
      'operator-1',
      'ask-urgent-1',
      'client@herba.com',
      'Site is down'
    );
  });

  it('does not re-notify on a re-sync of an already-urgent ask', async () => {
    mockFindUnique.mockResolvedValue({ id: 'ask-1', is_urgent: true });

    const res = await POST(postRequest({ asks: [baseAsk({ is_urgent: true })] }));
    const body = await res.json();

    expect(body.notified_urgent).toBe(0);
    expect(body.created).toBe(0);
    expect(mockNotifyUrgentEmail).not.toHaveBeenCalled();
  });

  it('notifies when an existing ask transitions non-urgent -> urgent', async () => {
    mockFindUnique.mockResolvedValue({ id: 'ask-1', is_urgent: false });

    const res = await POST(postRequest({ asks: [baseAsk({ is_urgent: true })] }));
    const body = await res.json();

    expect(body.notified_urgent).toBe(1);
    expect(mockNotifyUrgentEmail).toHaveBeenCalled();
  });

  it('includes from_name in the notification label when present', async () => {
    mockUpsert.mockImplementation(({ create }: { create: Record<string, unknown> }) =>
      Promise.resolve({ id: 'ask-2', ...create })
    );

    await POST(
      postRequest({
        asks: [baseAsk({ is_urgent: true, message_id: 'msg-2', from_name: 'Jane Client' })],
      })
    );

    expect(mockNotifyUrgentEmail).toHaveBeenCalledWith(
      'operator-1',
      'ask-2',
      'Jane Client <client@herba.com>',
      'Site is down'
    );
  });

  it('rejects a batch over 200', async () => {
    const asks = Array.from({ length: 201 }, (_, i) => baseAsk({ message_id: `msg-${i}` }));
    const res = await POST(postRequest({ asks }));
    expect(res.status).toBe(400);
  });

  it('rejects an empty batch', async () => {
    const res = await POST(postRequest({ asks: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects an ask missing required fields', async () => {
    const res = await POST(postRequest({ asks: [{ message_id: 'msg-x' }] }));
    expect(res.status).toBe(400);
  });

  it('rejects when unauthenticated', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireAuth.mockRejectedValue(new AuthError('Authentication required', 401));

    const res = await POST(postRequest({ asks: [baseAsk()] }));
    expect(res.status).toBe(401);
  });

  describe('Clarity Phase 6 — intent + proposed_event_* fields', () => {
    it('accepts intent and the proposed_event_* trio on create', async () => {
      const res = await POST(
        postRequest({
          asks: [
            baseAsk({
              message_id: 'msg-meeting',
              intent: 'meeting',
              proposed_event_at: '2026-07-24T19:30:00.000Z',
              proposed_event_title: 'Kickoff call',
              proposed_event_minutes: 45,
            }),
          ],
        })
      );

      expect(res.status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            intent: 'meeting',
            proposed_event_title: 'Kickoff call',
            proposed_event_minutes: 45,
          }),
        })
      );
    });

    it('rejects an invalid intent value', async () => {
      const res = await POST(postRequest({ asks: [baseAsk({ intent: 'urgent' })] }));
      expect(res.status).toBe(400);
    });

    it('legacy payloads (no Phase 6 fields at all) stay byte-compatible: those keys are absent from the upsert calls entirely', async () => {
      const res = await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-legacy' })] }));
      expect(res.status).toBe(200);

      const call = mockUpsert.mock.calls[0][0];
      for (const key of ['intent', 'proposed_event_at', 'proposed_event_title', 'proposed_event_minutes']) {
        expect(call.create).not.toHaveProperty(key);
        expect(call.update).not.toHaveProperty(key);
      }
    });

    it('a re-sync that omits the Phase 6 fields leaves them untouched on update (not nulled out)', async () => {
      mockFindUnique.mockResolvedValue({ id: 'ask-1', is_urgent: false });

      await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-1' })] }));

      const call = mockUpsert.mock.calls[0][0];
      expect(call.update).not.toHaveProperty('intent');
      expect(call.update).not.toHaveProperty('proposed_event_at');
    });
  });

  describe('Clarity Phase 6b — admin intent', () => {
    it('accepts intent: "admin" (business-critical non-client mail)', async () => {
      const res = await POST(
        postRequest({
          asks: [baseAsk({ message_id: 'msg-admin', intent: 'admin' })],
        })
      );

      expect(res.status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ intent: 'admin' }),
        })
      );
    });

    it('still rejects an invalid intent value alongside the new admin value', async () => {
      const res = await POST(postRequest({ asks: [baseAsk({ intent: 'invoice' })] }));
      expect(res.status).toBe(400);
    });
  });

  describe('Oracle Projects Tab Phase 2 — client/project auto-match', () => {
    it('exactly one client, exactly one eligible project -> match_source auto', async () => {
      mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-1' }]);
      mockProjectFindMany.mockResolvedValue([{ id: 'project-1' }]);

      const res = await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-auto' })] }));

      expect(res.status).toBe(200);
      expect(mockClientContactFindMany).toHaveBeenCalledWith({
        where: { email: { equals: 'client@herba.com', mode: 'insensitive' }, is_deleted: false },
        select: { client_id: true },
      });
      expect(mockProjectFindMany).toHaveBeenCalledWith({
        where: {
          client_id: 'client-1',
          type: 'project',
          status: { in: ['ready', 'in_progress', 'review'] },
          is_deleted: false,
        },
        select: { id: true },
      });
      expect(mockEmailAskUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { client_id: 'client-1', project_id: 'project-1', match_source: 'auto' },
      });
    });

    it('one client but zero eligible projects -> match_source unmatched, project_id null', async () => {
      mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-1' }]);
      mockProjectFindMany.mockResolvedValue([]);

      await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-zero-projects' })] }));

      expect(mockEmailAskUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { client_id: 'client-1', project_id: null, match_source: 'unmatched' },
      });
    });

    it('one client but TWO+ eligible projects -> match_source unmatched, project_id null', async () => {
      mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-1' }]);
      mockProjectFindMany.mockResolvedValue([{ id: 'project-1' }, { id: 'project-2' }]);

      await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-two-projects' })] }));

      expect(mockEmailAskUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { client_id: 'client-1', project_id: null, match_source: 'unmatched' },
      });
    });

    it('no contact resolves for the sender -> leaves client_id/project_id/match_source untouched', async () => {
      mockClientContactFindMany.mockResolvedValue([]);

      await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-no-contact' })] }));

      expect(mockProjectFindMany).not.toHaveBeenCalled();
      expect(mockEmailAskUpdate).not.toHaveBeenCalled();
    });

    it('never overwrites an existing match_source=mike row', async () => {
      mockUpsert.mockResolvedValue({
        id: 'ask-mike',
        client_id: 'client-9',
        project_id: 'project-9',
        match_source: 'mike',
      });
      mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-1' }]);
      mockProjectFindMany.mockResolvedValue([{ id: 'project-1' }]);

      await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-mike-owned' })] }));

      // The auto-matcher must never even query contacts for a Mike-ruled row, let alone
      // overwrite it.
      expect(mockClientContactFindMany).not.toHaveBeenCalled();
      expect(mockEmailAskUpdate).not.toHaveBeenCalled();
    });

    it('never downgrades an existing auto match when the resolved client is unchanged, even if the eligible-project count has since changed', async () => {
      mockUpsert.mockResolvedValue({
        id: 'ask-auto',
        client_id: 'client-1',
        project_id: 'project-1',
        match_source: 'auto',
      });
      mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-1' }]);
      // Even though the live query would now find zero eligible projects...
      mockProjectFindMany.mockResolvedValue([]);

      await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-stay-auto' })] }));

      // ...the existing auto match is left alone rather than downgraded to unmatched.
      expect(mockProjectFindMany).not.toHaveBeenCalled();
      expect(mockEmailAskUpdate).not.toHaveBeenCalled();
    });

    // LOW-11
    it('is a no-op when the row is already correctly unmatched (one client, zero eligible projects)', async () => {
      mockUpsert.mockResolvedValue({
        id: 'ask-already-unmatched',
        client_id: 'client-1',
        project_id: null,
        match_source: 'unmatched',
      });
      mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-1' }]);
      mockProjectFindMany.mockResolvedValue([]); // would recompute to the exact same shape

      await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-noop-unmatched' })] }));

      expect(mockEmailAskUpdate).not.toHaveBeenCalled();
    });

    // LOW-11
    it('is a no-op when the row is already correctly auto-matched to the same client and project', async () => {
      mockUpsert.mockResolvedValue({
        id: 'ask-already-auto',
        client_id: 'client-1',
        project_id: 'project-1',
        match_source: 'auto',
      });
      mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-1' }]);
      mockProjectFindMany.mockResolvedValue([{ id: 'project-1' }]);

      await POST(postRequest({ asks: [baseAsk({ message_id: 'msg-noop-auto' })] }));

      // Note: the SAME-client 'auto' short-circuit already returns before recomputing
      // eligible projects at all — this is really exercising that earlier branch, which
      // is itself the strongest possible no-op (it never even re-queries).
      expect(mockProjectFindMany).not.toHaveBeenCalled();
      expect(mockEmailAskUpdate).not.toHaveBeenCalled();
    });

    // LOW-12 — behavioral case-insensitivity: an uppercase sender address still resolves
    // through to the correct client/project, and the DB query itself carries the raw
    // (unmodified) address with mode: 'insensitive' rather than the route lowercasing it
    // itself.
    it('resolves the client/project for an UPPERCASE sender email (case-insensitive match)', async () => {
      mockClientContactFindMany.mockResolvedValue([{ client_id: 'client-1' }]);
      mockProjectFindMany.mockResolvedValue([{ id: 'project-1' }]);

      const res = await POST(
        postRequest({
          asks: [baseAsk({ message_id: 'msg-uppercase', from_email: 'MIKE@X.com' })],
        })
      );

      expect(res.status).toBe(200);
      expect(mockClientContactFindMany).toHaveBeenCalledWith({
        where: { email: { equals: 'MIKE@X.com', mode: 'insensitive' }, is_deleted: false },
        select: { client_id: true },
      });
      expect(mockEmailAskUpdate).toHaveBeenCalledWith({
        where: { id: 'ask-1' },
        data: { client_id: 'client-1', project_id: 'project-1', match_source: 'auto' },
      });
    });
  });
});

// Work stage A: the RFC keys ride on the sync, normalized, and absent means untouched.
describe('POST /api/oracle/email-sync: rfc_message_id and conversation_key', () => {
  it('stores both lowercased with no brackets', async () => {
    mockUpsert.mockResolvedValue({ id: 'ask-1', is_urgent: false, client_id: null, project_id: null, match_source: null });
    mockClientContactFindMany.mockResolvedValue([]);
    const res = await POST(postRequest({ asks: [baseAsk({ rfc_message_id: '<ABC@Mail.test>', conversation_key: ' <Root@Mail.test> ' })] }));
    expect(res.status).toBe(200);
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ rfc_message_id: 'abc@mail.test', conversation_key: 'root@mail.test' });
    expect(arg.update).toMatchObject({ rfc_message_id: 'abc@mail.test', conversation_key: 'root@mail.test' });
  });

  it('absent keys are not sent to the update at all', async () => {
    mockUpsert.mockResolvedValue({ id: 'ask-1', is_urgent: false, client_id: null, project_id: null, match_source: null });
    mockClientContactFindMany.mockResolvedValue([]);
    await POST(postRequest({ asks: [baseAsk()] }));
    const arg = mockUpsert.mock.calls[0][0];
    expect('rfc_message_id' in arg.update).toBe(false);
    expect('conversation_key' in arg.update).toBe(false);
    expect('rfc_message_id' in arg.create).toBe(false);
  });

  it('refuses a key over 255 characters', async () => {
    const res = await POST(postRequest({ asks: [baseAsk({ conversation_key: 'x'.repeat(256) })] }));
    expect(res.status).toBe(400);
  });
});


// Work stage B: one intake decision per message.
describe('POST /api/oracle/email-sync: the intake decision (work stage B)', () => {
  const homeOn = () => {
    mockSettings.mockResolvedValue({ owner_user_id: 'owner-1' });
    mockUserFindUnique.mockResolvedValue({ id: 'owner-1', email: 'mike@becomeindelible.com', is_active: true, role: 'admin', preferences: { home_view: 'home', timezone: 'America/New_York' } });
  };
  const row = (extra: Record<string, unknown> = {}) => ({ id: 'ask-1', is_urgent: false, client_id: null, project_id: null, match_source: null, disposition: null, ...extra });
  const created = () => mockUpsert.mock.calls[0][0].create as Record<string, unknown>;

  it('no_action on a new row is created handled with the intake close record, a reason and owner nobody', async () => {
    homeOn();
    mockUpsert.mockResolvedValue(row({ disposition: 'no_action' }));
    const res = await POST(postRequest({ asks: [baseAsk({ disposition: 'no_action', disposition_reason: 'A thank-you, nothing asked \u2014 no reply' })] }));
    const body = await res.json();
    expect(created()).toMatchObject({ state: 'handled', closed_reason: 'no_action', closed_by: 'intake', disposition: 'no_action', owner: 'nobody', decided_by: 'intake' });
    expect(created().disposition_reason).toBe('A thank-you, nothing asked , no reply');
    expect(body.items[0]).toMatchObject({ message_id: 'msg-1', id: 'ask-1', disposition: 'no_action' });
    expect(waitStore.insertIdempotent).not.toHaveBeenCalled();
  });

  it('an urgent ask sent as no_action is stored as reply_mike, open, and reported in adjusted', async () => {
    homeOn();
    mockUpsert.mockResolvedValue(row({ is_urgent: true, disposition: 'reply_mike' }));
    const res = await POST(postRequest({ asks: [baseAsk({ is_urgent: true, disposition: 'no_action' })] }));
    const body = await res.json();
    expect(created()).toMatchObject({ disposition: 'reply_mike', owner: 'mike' });
    expect('state' in created()).toBe(false);
    expect(body.items[0].adjusted).toBe('no_action_refused_urgent');
    expect(body.adjusted).toHaveLength(1);
  });

  it.each(['admin', 'sales'])('intent %s can never be no_action or waiting_them', async (intent) => {
    homeOn();
    mockUpsert.mockResolvedValue(row({ disposition: 'reply_mike' }));
    for (const d of ['no_action', 'waiting_them']) {
      mockUpsert.mockClear();
      await POST(postRequest({ asks: [baseAsk({ intent, disposition: d })] }));
      expect(created()).toMatchObject({ disposition: 'reply_mike' });
      expect('state' in created()).toBe(false);
    }
    expect(waitStore.insertIdempotent).not.toHaveBeenCalled();
  });

  it('waiting_them on a new row is created handled and opens exactly one wait keyed by the conversation', async () => {
    homeOn();
    mockUpsert.mockResolvedValue(row({ disposition: 'waiting_them' }));
    waitStore.insertIdempotent.mockResolvedValue({ wait: { id: 'w1', due_at: new Date() }, created: true });
    await POST(postRequest({ asks: [baseAsk({ disposition: 'waiting_them', conversation_key: '<Root@Mail.test>' })] }));
    expect(created()).toMatchObject({ state: 'handled', closed_reason: 'waiting_them', closed_by: 'intake' });
    expect(waitStore.insertIdempotent).toHaveBeenCalledTimes(1);
    expect(waitStore.insertIdempotent.mock.calls[0][0]).toMatchObject({ template_key: 'mail.awaiting_reply', idempotency_key: 'conv:root@mail.test' });
    expect(waitStore.addEvent).toHaveBeenCalledTimes(1);
  });

  it('without the owner on the home view nothing about the decision is stored and nothing closes', async () => {
    mockUpsert.mockResolvedValue(row());
    const res = await POST(postRequest({ asks: [baseAsk({ disposition: 'no_action' })] }));
    const body = await res.json();
    expect('disposition' in created()).toBe(false);
    expect('state' in created()).toBe(false);
    expect(body.skipped).toBe('home_off');
  });

  it('an existing undecided row is never closed by a later sync, and reports prior', async () => {
    homeOn();
    mockFindUnique.mockResolvedValue({ id: 'ask-1', is_urgent: false, disposition: null, decided_by: null, intent: null, task_id: null, state: 'open', closed_by: null, task: null });
    mockUpsert.mockResolvedValue(row());
    const res = await POST(postRequest({ asks: [baseAsk({ disposition: 'no_action' })] }));
    const body = await res.json();
    const arg = mockUpsert.mock.calls[0][0];
    expect('disposition' in arg.update).toBe(false);
    expect('state' in arg.update).toBe(false);
    expect(body.items[0].prior).toEqual({ disposition: null, task_id: null });
    expect(body.items[0].adjusted).toBe('close_only_at_birth');
  });

  it('an existing undecided row takes reply_mike', async () => {
    homeOn();
    mockFindUnique.mockResolvedValue({ id: 'ask-1', is_urgent: false, disposition: null, decided_by: null, intent: null, task_id: null, state: 'open', closed_by: null, task: null });
    mockUpsert.mockResolvedValue(row({ disposition: 'reply_mike' }));
    await POST(postRequest({ asks: [baseAsk({ disposition: 'reply_mike' })] }));
    expect(mockUpsert.mock.calls[0][0].update).toMatchObject({ disposition: 'reply_mike', decided_by: 'intake' });
  });

  it('a row he reopened (decided_by mike) is never touched by a later decision', async () => {
    homeOn();
    mockFindUnique.mockResolvedValue({ id: 'ask-1', is_urgent: false, disposition: 'reply_mike', decided_by: 'mike', intent: null, task_id: null, state: 'open', closed_by: null, task: null });
    mockUpsert.mockResolvedValue(row({ disposition: 'reply_mike' }));
    await POST(postRequest({ asks: [baseAsk({ disposition: 'no_action' })] }));
    const arg = mockUpsert.mock.calls[0][0];
    expect('disposition' in arg.update).toBe(false);
    expect('decided_by' in arg.update).toBe(false);
  });

  it('an intake close that turns urgent reopens as an emergency', async () => {
    homeOn();
    mockFindUnique.mockResolvedValue({ id: 'ask-1', is_urgent: false, disposition: 'no_action', decided_by: 'intake', intent: null, task_id: null, state: 'handled', closed_by: 'intake', task: null });
    mockUpsert.mockResolvedValue(row({ is_urgent: true, disposition: 'emergency' }));
    await POST(postRequest({ asks: [baseAsk({ is_urgent: true, disposition: 'emergency' })] }));
    expect(mockUpsert.mock.calls[0][0].update).toMatchObject({ state: 'open', disposition: 'emergency', closed_reason: null, closed_by: null, closed_at: null });
  });

  it('refuses a disposition outside the list and a decided_by of mike', async () => {
    expect((await POST(postRequest({ asks: [baseAsk({ disposition: 'ignore' })] }))).status).toBe(400);
    expect((await POST(postRequest({ asks: [baseAsk({ decided_by: 'mike' })] }))).status).toBe(400);
  });

  it('absent decision fields leave the payload byte-compatible with the old classifier', async () => {
    homeOn();
    mockUpsert.mockResolvedValue(row());
    await POST(postRequest({ asks: [baseAsk()] }));
    const arg = mockUpsert.mock.calls[0][0];
    for (const k of ['disposition', 'disposition_reason', 'owner', 'decided_by', 'state']) {
      expect(k in arg.create).toBe(false);
      expect(k in arg.update).toBe(false);
    }
  });
});
