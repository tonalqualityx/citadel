import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { MemStore } from '@/lib/waits/testing-mem-store';
import { MIKE_USER_ID } from '@/lib/waits/owner';

const store = new MemStore();

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/waits/prisma-store', () => ({ prismaSweepStore: () => store }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    wait: { findMany: vi.fn() },
    user: { findUnique: vi.fn(async () => ({ is_active: true })) },
    function: { findUnique: vi.fn(async () => null) },
    projectTeamAssignment: { findMany: vi.fn(async () => []) },
    accord: { findUnique: vi.fn(async () => null) },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import type { Mock } from 'vitest';

const post = (body: object) =>
  new NextRequest('http://localhost/api/waits', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const get = (qs = '') => new NextRequest(`http://localhost/api/waits${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  store.waits.clear();
  store.events.length = 0;
  store.seq = 0;
  (requireAuth as Mock).mockResolvedValue({ userId: MIKE_USER_ID, role: 'admin', email: 'mike@becomeindelible.com' });
  (requireRole as Mock).mockImplementation(() => {});
});

describe('POST /api/waits', () => {
  it('opens a live template and answers 201 with the resolved owner', async () => {
    const res = await POST(post({ template_key: 'build.gate_mike', subject: 'the VCDP sitemap', client_id: '11111111-1111-4111-8111-111111111111' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({
      template_key: 'build.gate_mike',
      title: 'Approve the VCDP sitemap',
      state: 'waiting',
      blocks_client: true,
      terminal_action: 'escalate',
      resolved_owner: { user_id: MIKE_USER_ID, source: 'mike' },
    });
    expect(store.events.map((e) => e.kind)).toEqual(['created']);
  });

  it('opens a price review at step 1 only; a later step by hand is refused', async () => {
    const ok = await POST(post({ template_key: 'charter.price_review', subject: 'Acme', due_at: '2026-11-02T14:00:00Z', charter_id: '11111111-1111-4111-8111-111111111111' }));
    expect(ok.status).toBe(201);
    for (const step of [2, 3, 4]) {
      const res = await POST(post({ template_key: 'charter.price_review', subject: 'Acme', step, due_at: '2026-11-02T14:00:00Z', charter_id: '11111111-1111-4111-8111-111111111111' }));
      expect(res.status).toBe(400);
    }
    expect(store.all()).toHaveLength(1);
  });

  it('refuses a registered-but-disabled template with 409', async () => {
    const res = await POST(post({ template_key: 'sales.proposal_unopened', subject: 'x' }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('template_disabled');
    expect(store.all()).toHaveLength(0);
  });

  it('refuses an unknown template and malformed input', async () => {
    expect((await POST(post({ template_key: 'nope', subject: 'x' }))).status).toBe(400);
    expect((await POST(post({ subject: 'x' }))).status).toBe(400);
    expect((await POST(post({ template_key: 'build.gate_mike', client_id: 'not-a-uuid', subject: 'x' }))).status).toBe(400);
  });

  it('is idempotent on idempotency_key', async () => {
    const body = { template_key: 'build.gate_mike', subject: 'the sitemap', idempotency_key: 'wright:vcdp:sitemap' };
    expect((await POST(post(body))).status).toBe(201);
    const again = await POST(post(body));
    expect(again.status).toBe(200);
    expect(store.all()).toHaveLength(1);
  });

  it('requires pm or admin', async () => {
    (requireRole as Mock).mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    expect((await POST(post({ template_key: 'build.gate_mike', subject: 'x' }))).status).toBe(403);
  });
});

describe('POST /api/waits payload smuggling', () => {
  it('strips every action-shaping key a caller sends, keeping only the allowlisted notes', async () => {
    const res = await POST(
      post({
        template_key: 'handoff.generic',
        subject: 'a plain handoff',
        action_payload: {
          guard: 'review_clock_on',
          fallback: 'send',
          effect: 'publish_staged_change',
          escalate_to: 'mike',
          owner_role: 'sales',
          shepherd_role: 'pm',
          switch_owner_user_id: 'x',
          note: 'Call Dan',
        },
      })
    );
    expect(res.status).toBe(201);
    const stored = [...store.waits.values()][0].action_payload as Record<string, unknown>;
    for (const k of ['guard', 'fallback', 'effect', 'escalate_to', 'shepherd_role', 'switch_owner_user_id']) expect(stored).not.toHaveProperty(k);
    expect(stored.owner_role).toBe('mike'); // the template's, not the caller's
    expect(stored.note).toBe('Call Dan');
    expect([...store.waits.values()][0].terminal_action).toBe('escalate');
  });
});

describe('GET /api/waits', () => {
  it('lists open waits by default and filters by resolved owner', async () => {
    const mine = store.add({
      kind: 'approval', template_key: 'build.gate_mike', step: 1, title: 'Approve a', detail: null,
      owner_function_id: null, owner_user_id: null, owner_contact_id: null, client_id: null, accord_id: null,
      project_id: null, charter_id: null, site_id: null, task_id: null, arc_id: null, approval_request_id: null,
      email_thread_id: null, email_account: null, started_at: new Date(), duration_value: 2, duration_unit: 'business_days',
      due_at: new Date(), blocks_client: true, client_waiting_since: null, terminal_action: 'escalate',
      action_payload: { owner_role: 'mike' }, created_by_id: null, created_by_automation: null, idempotency_key: null,
    } as never);
    const theirs = store.add({ ...({} as object), kind: 'approval', template_key: 'build.gate_mike', step: 1, title: 'Approve b', detail: null,
      owner_function_id: null, owner_user_id: '22222222-2222-4222-8222-222222222222', owner_contact_id: null, client_id: null, accord_id: null,
      project_id: null, charter_id: null, site_id: null, task_id: null, arc_id: null, approval_request_id: null,
      email_thread_id: null, email_account: null, started_at: new Date(), duration_value: 2, duration_unit: 'business_days',
      due_at: new Date(), blocks_client: true, client_waiting_since: null, terminal_action: 'escalate',
      action_payload: {}, created_by_id: null, created_by_automation: null, idempotency_key: null } as never);
    (prisma.wait.findMany as Mock).mockResolvedValue([mine, theirs]);

    const all = await (await GET(get())).json();
    expect(all.data).toHaveLength(2);
    const onlyMike = await (await GET(get('?owner=me'))).json();
    expect(onlyMike.data.map((w: { id: string }) => w.id)).toEqual([mine.id]);
    const where = (prisma.wait.findMany as Mock).mock.calls[0][0].where;
    expect(where.state).toEqual({ in: ['waiting', 'needs_human', 'paused', 'blocked_by_switch'] });
  });

  it('rejects an unknown state or kind', async () => {
    expect((await GET(get('?state=weird'))).status).toBe(400);
    expect((await GET(get('?kind=weird'))).status).toBe(400);
  });
});
