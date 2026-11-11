// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { NOT_WORKERS, WORKER, req } from '../../../__tests__/harness';

const h = vi.hoisted(() => ({ rows: [] as unknown[], tasks: [] as unknown[] }));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    emailOutbox: { findMany: vi.fn(async () => h.rows) },
    task: { findMany: vi.fn(async () => h.tasks) },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import { bastChatEndpoints } from '@/lib/api/registry/bast-chat';
import { GET, nameAndDomain, plainReason } from '../route';

const P = '/api/bast-chat/worker/sends';
const TASK = '5c0f2a3b-0000-4000-8000-0000000000aa';
const row = (over: Record<string, unknown> = {}) => ({
  to: 'Jeffrey Ayers <jeffrey@lifelineiv.com>',
  subject: 'Your preview is ready',
  kind: 'approval',
  from_account: 'bast@becomeindelible.com',
  created_at: new Date('2026-11-11T14:00:00Z'),
  send_after: null,
  sent_at: new Date('2026-11-11T14:01:00Z'),
  superseded_reason: null,
  last_error: null,
  task_id: TASK,
  ...over,
});
const get = (qs = '') => GET(req('GET', `${P}${qs}`) as never);
const findMany = () => vi.mocked(prisma.emailOutbox.findMany);

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [row()];
  h.tasks = [{ id: TASK, client: { name: 'Lifeline Vascular' } }];
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
});

describe('GET worker/sends', () => {
  it('is in the lane list and the registry, as a GET only', () => {
    const entries = LANE_ROUTES['bast-chat'].filter((r) => r.pattern === P);
    expect(entries.map((r) => r.method)).toEqual(['GET']);
    expect(bastChatEndpoints.some((e) => e.path === P)).toBe(true);
  });
  it('401 signed out, 403 for everyone but the chat worker, and no query runs', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
    expect((await get()).status).toBe(401);
    for (const [, auth] of NOT_WORKERS) {
      vi.mocked(requireAuth).mockResolvedValue(auth);
      expect((await get()).status).toBe(403);
    }
    expect(findMany()).not.toHaveBeenCalled();
  });
  it('returns the exact row shape, no-store, with name and domain and no address or body', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({
      items: [
        {
          kind: 'approval',
          to: { name: 'Jeffrey Ayers', domain: 'lifelineiv.com' },
          subject: 'Your preview is ready',
          queued_at: '2026-11-11T14:00:00.000Z',
          send_after: null,
          sent_at: '2026-11-11T14:01:00.000Z',
          superseded_reason: null,
          failed_reason: null,
          from_account: 'bast@becomeindelible.com',
          client: 'Lifeline Vascular',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('jeffrey@');
    const sel = findMany().mock.calls[0]![0]!.select as Record<string, boolean>;
    for (const k of ['text', 'html', 'cc', 'message_id', 'reply_to', 'govern']) expect(sel[k]).toBeUndefined();
  });
  it('lists newest first, defaults to 10 and caps at 25', async () => {
    await get();
    expect(findMany().mock.calls[0]![0]).toMatchObject({ orderBy: { created_at: 'desc' }, take: 10 });
    await get('?limit=25');
    expect(findMany().mock.calls[1]![0]).toMatchObject({ take: 25 });
    expect((await get('?limit=26')).status).toBe(400);
    expect((await get('?limit=0')).status).toBe(400);
  });
  it('filters on to, subject, kind and since', async () => {
    await get('?to=Lifeline&subject=preview&kind=approval&since=2026-11-01');
    const where = findMany().mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(where).toEqual({
      to: { contains: 'Lifeline', mode: 'insensitive' },
      subject: { contains: 'preview', mode: 'insensitive' },
      kind: 'approval',
      created_at: { gte: new Date('2026-11-01') },
    });
  });
  it('400 for a bad since, a bad kind and a field it does not know', async () => {
    expect((await get('?since=lately')).status).toBe(400);
    expect((await get('?kind=A%20B')).status).toBe(400);
    expect((await get('?body=1')).status).toBe(400);
    expect(findMany()).not.toHaveBeenCalled();
  });
  it('shows a held, a dropped and a failed send, and nulls a missing client', async () => {
    h.rows = [
      row({ sent_at: null, send_after: new Date('2026-11-11T14:10:00Z'), task_id: null }),
      row({ sent_at: null, superseded_reason: 'client_replied', last_error: 'old error' }),
      row({ sent_at: null, last_error: 'gmail 403 Bearer abc123 reading /home/mike/.x/key' }),
    ];
    const items = (await (await get()).json()).items;
    expect(items[0]).toMatchObject({ sent_at: null, send_after: '2026-11-11T14:10:00.000Z', client: null, failed_reason: null });
    expect(items[1]).toMatchObject({ superseded_reason: 'client_replied', failed_reason: null });
    expect(items[2].failed_reason).toBe('gmail 403 Bearer [redacted] reading [path]');
  });
  it('writes nothing: only findMany is ever called', async () => {
    await get();
    expect(Object.keys(prisma.emailOutbox)).toEqual(['findMany']);
    expect(Object.keys(prisma.task)).toEqual(['findMany']);
  });
});

describe('the name and reason helpers', () => {
  it('give a display name or local part and a domain, never the address', () => {
    expect(nameAndDomain('"Ayers, J" <j@x.com>')).toEqual({ name: 'Ayers, J', domain: 'x.com' });
    expect(nameAndDomain('jeffrey@lifelineiv.com')).toEqual({ name: 'jeffrey', domain: 'lifelineiv.com' });
    expect(nameAndDomain('garbage')).toEqual({ name: null, domain: null });
  });
  it('plainReason cuts at 200 and returns null for empty', () => {
    expect(plainReason('x'.repeat(500))).toHaveLength(200);
    expect(plainReason('')).toBeNull();
    expect(plainReason(null)).toBeNull();
  });
});
