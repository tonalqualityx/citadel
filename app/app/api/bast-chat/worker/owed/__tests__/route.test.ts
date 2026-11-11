// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';
import { NOT_WORKERS, OWNER_ID, WORKER, req } from '../../../__tests__/harness';
import { makeFakeDb, type FakeAsk } from '@/lib/home/owed/__tests__/fixtures/fake-db';
import { NOW, d, makeClient, makeThread } from '@/lib/home/__tests__/fixtures/tonight';

const h = vi.hoisted(() => ({ ownerId: '3ecfb7be-0000-4000-8000-000000000001' as string | null, db: null as unknown as Record<string, unknown>, raw: { threads: [] as unknown[], crises: [] as unknown[] } }));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: new Proxy({}, { get: (_t, p: string) => h.db[p] }) }));
vi.mock('@/lib/bast-chat/route-helpers', async (orig) => ({
  ...(await orig<typeof import('@/lib/bast-chat/route-helpers')>()),
  workerOwnerId: vi.fn(async () => {
    if (!h.ownerId) {
      const { ApiError } = await import('@/lib/api/errors');
      throw new ApiError('Chat not found', 404, 'not_found');
    }
    return h.ownerId;
  }),
}));
vi.mock('@/lib/home/load', () => ({ loadHomeInputs: vi.fn(async () => h.raw) }));

import { requireAuth } from '@/lib/auth/middleware';
import { LANE_ROUTES } from '@/lib/auth/lane-scopes';
import { bastChatEndpoints } from '@/lib/api/registry/bast-chat';
import { threadKey } from '@/lib/home/item-key';
import { GET, POST } from '../route';
import { WRITE_METHODS } from '@/lib/home/owed/__tests__/fixtures/fake-db';

const PATH = '/api/bast-chat/worker/owed';
const ACCOUNT = 'mike@becomeindelible.com';
const ASK = 'aaaaaaaa-0000-4000-8000-000000000001';
const THREAD_ID = 'thr-1';
const KEY = threadKey(ACCOUNT, THREAD_ID);

const fakeAsk = (over: Partial<FakeAsk> = {}): FakeAsk => ({
  id: ASK, account: ACCOUNT, thread_id: THREAD_ID, message_id: 'm1', state: 'open', is_urgent: false, received_at: new Date('2026-11-05T15:00:00Z'),
  from_name: 'Jessica Everlith', from_email: 'j@example.com', ...over,
});
const drafted = (over: Record<string, unknown> = {}) => ({
  thread_key: KEY, newest_ask_id: ASK, outcome: 'drafted', draft_id: 'r1', draft_message_id: 'g1', draft_text: 'Thanks, got this. I\'ll get back to you.\n\nMike', model: 'sonnet', cost_usd: 0.05, ...over,
});

let fake: ReturnType<typeof makeFakeDb>;
function setDb(opts: Parameters<typeof makeFakeDb>[0] = { asks: [fakeAsk()] }) {
  fake = makeFakeDb(opts);
  h.db = fake.db as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.ownerId = OWNER_ID;
  h.raw = { threads: [], crises: [] };
  vi.mocked(requireAuth).mockResolvedValue(WORKER);
  setDb();
});

const callers: [string, () => Promise<Response>][] = [
  ['GET', () => GET(req('GET', PATH) as never)],
  ['POST', () => POST(req('POST', PATH, { items: [drafted()] }) as never)],
];

describe('owed route: who may call', () => {
  for (const [name, call] of callers) {
    it(`${name}: 401 when signed out`, async () => {
      vi.mocked(requireAuth).mockRejectedValue(new AuthError('Authentication required', 401));
      expect((await call()).status).toBe(401);
      expect(fake.reads).toEqual([]);
      expect(fake.writes).toEqual([]);
    });
    for (const [who, auth] of NOT_WORKERS) {
      it(`${name}: 403 for ${who}`, async () => {
        vi.mocked(requireAuth).mockResolvedValue(auth);
        expect((await call()).status).toBe(403);
        expect(fake.reads).toEqual([]);
        expect(fake.writes).toEqual([]);
      });
    }
    it(`${name}: 404 when no chat owner is configured`, async () => {
      h.ownerId = null;
      expect((await call()).status).toBe(404);
      expect(fake.writes).toEqual([]);
    });
    it(`${name}: skips home_off for an owner not on the home view, and writes nothing`, async () => {
      setDb({ owner: { is_active: true, role: 'admin', home_view: 'classic' }, asks: [fakeAsk()] });
      const res = await call();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe('home_off');
      expect(body.items ?? body.saved).toEqual([]);
      expect(fake.writes).toEqual([]);
      expect(fake.rows.size).toBe(0);
    });
  }
});

describe('owed route: GET', () => {
  it('lists the queue in the planned shape, no-store, and writes nothing', async () => {
    const client = makeClient('Active Co');
    const t = makeThread({ account: ACCOUNT, thread_id: THREAD_ID, id: ASK, message_id: 'm1', client, received_at: d('2026-11-02T15:00:00Z'), intent: 'sales' });
    h.raw = { threads: [t], crises: [] };
    void NOW;
    const res = await GET(req('GET', PATH) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0]).sort()).toEqual(['account', 'ask_ids', 'bast_draft', 'client_name', 'lead', 'newest', 'request', 'suggested_answer', 'thread_id', 'thread_key'].sort());
    expect(Object.keys(body.items[0].newest).sort()).toEqual(['ask_id', 'from_email', 'from_name', 'gmail_id', 'intent', 'received_at', 'subject']);
    expect(body.items[0]).toMatchObject({ thread_key: KEY, ask_ids: [ASK], client_name: 'Active Co', lead: true, request: null, suggested_answer: null, bast_draft: null });
    expect(body.items[0].newest).toMatchObject({ ask_id: ASK, gmail_id: 'm1' });
    expect(fake.writes).toEqual([]);
    for (const r of fake.reads) expect(WRITE_METHODS.some((m) => r.endsWith(`.${m}`))).toBe(false);
  });
  it('leaves out a crisis thread, and limit only lowers the cap', async () => {
    const client = makeClient('Active Co');
    const mk = (n: number) => makeThread({ account: ACCOUNT, thread_id: `t${n}`, client, received_at: new Date(d('2026-11-02T15:00:00Z').getTime() + n * 60_000) });
    const threads = Array.from({ length: 8 }, (_, i) => mk(i));
    const crisis = makeThread({ account: ACCOUNT, thread_id: 't0', is_urgent: true, client });
    h.raw = { threads, crises: [crisis] };
    const all = await (await GET(req('GET', PATH) as never)).json();
    expect(all.items).toHaveLength(6);
    expect(all.items.map((i: { thread_id: string }) => i.thread_id)).not.toContain('t0');
    expect((await (await GET(req('GET', `${PATH}?limit=2`) as never)).json()).items).toHaveLength(2);
    expect((await (await GET(req('GET', `${PATH}?limit=99`) as never)).json()).items).toHaveLength(6);
    expect((await (await GET(req('GET', `${PATH}?limit=abc`) as never)).json()).items).toHaveLength(6);
  });
});

describe('owed route: ?caps (Slice 4c)', () => {
  it('with caps the items carry full_draft_text and joined; without them the 4a keys only', async () => {
    const client = makeClient('Active Co');
    const t = makeThread({ account: ACCOUNT, thread_id: THREAD_ID, id: ASK, message_id: 'm1', client, received_at: d('2026-11-02T15:00:00Z') });
    h.raw = { threads: [t], crises: [] };
    const capped = await (await GET(req('GET', `${PATH}?caps=short,auto,joins`) as never)).json();
    expect(capped.items[0]).toMatchObject({ full_draft_text: null, joined: [] });
    const some = await (await GET(req('GET', `${PATH}?caps=auto`) as never)).json();
    expect(some.items[0]).not.toHaveProperty('full_draft_text');
    expect(some.items[0]).not.toHaveProperty('joined');
    const plain = await (await GET(req('GET', PATH) as never)).json();
    expect(plain.items[0]).not.toHaveProperty('full_draft_text');
    expect(plain.items[0]).not.toHaveProperty('joined');
    expect(fake.writes).toEqual([]);
  });
  it('POST accepts the new outcomes and joins, and refuses a stray field', async () => {
    const short = { thread_key: KEY, newest_ask_id: ASK, outcome: 'short_drafted', short_draft_id: 's', short_draft_text: 'Thanks. Got it.', model: 'haiku', joins: [{ account: 'bast@becomeindelible.com', thread_id: 'x' }] };
    expect((await POST(req('POST', PATH, { items: [short] }) as never)).status).toBe(200);
    const replied = { thread_key: KEY, newest_ask_id: ASK, outcome: 'replied_elsewhere', replied_from: 'support@becomeindelible.com', replied_at: '2026-11-06T15:00:00Z' };
    expect((await POST(req('POST', PATH, { items: [replied] }) as never)).status).toBe(200);
    expect((await POST(req('POST', PATH, { items: [{ ...replied, extra: 1 }] }) as never)).status).toBe(400);
    expect((await POST(req('POST', PATH, { items: [{ ...replied, replied_at: 'yesterday' }] }) as never)).status).toBe(400);
  });
});

describe('owed route: POST', () => {
  it('saves a clean draft for the owner, no-store, and writes only home tables', async () => {
    const res = await POST(req('POST', PATH, { items: [drafted()] }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.saved).toEqual([{ thread_key: KEY, outcome: 'drafted' }]);
    expect(body.refused).toEqual([]);
    expect(body.line).toBe('Drafted a reply to Jessica Everlith. It is in your Gmail drafts.');
    expect(body.action_id).toBeTruthy();
    expect(fake.rows.size).toBe(1);
    expect(fake.runs.size).toBe(1);
    expect([...new Set(fake.writes)].sort()).toEqual(['homeAction.create', 'homeKeeperRun.upsert', 'homeOwedThread.upsert']);
  });
  it('refuses a dashed body and a $500 body, saves a clean one', async () => {
    const a2 = 'aaaaaaaa-0000-4000-8000-000000000002';
    const a3 = 'aaaaaaaa-0000-4000-8000-000000000003';
    setDb({ asks: [fakeAsk(), fakeAsk({ id: a2, thread_id: 'thr-2', message_id: 'm2' }), fakeAsk({ id: a3, thread_id: 'thr-3', message_id: 'm3' })] });
    const res = await POST(
      req('POST', PATH, {
        items: [
          drafted({ draft_text: 'Thanks — got it.' }),
          drafted({ thread_key: threadKey(ACCOUNT, 'thr-2'), newest_ask_id: a2, draft_text: 'That would be $500.' }),
          drafted({ thread_key: threadKey(ACCOUNT, 'thr-3'), newest_ask_id: a3 }),
        ],
      }) as never,
    );
    const body = await res.json();
    expect(body.refused.map((r: { reason: string }) => r.reason)).toEqual(['draft_shape', 'draft_money']);
    expect(body.saved).toEqual([{ thread_key: threadKey(ACCOUNT, 'thr-3'), outcome: 'drafted' }]);
    // the two refused texts are counted as failed attempts
    expect(fake.rows.size).toBe(3);
    expect(fake.rows.get(`${OWNER_ID}|${KEY}`)).toMatchObject({ state: 'failed', attempts: 1, last_error: 'refused: draft_shape' });
  });
  it('dry: true answers saved and refused and writes nothing; dry absent or false is the real save', async () => {
    const dry = await POST(req('POST', PATH, { items: [drafted()], dry: true }) as never);
    expect(dry.status).toBe(200);
    const body = await dry.json();
    expect(body.saved).toEqual([{ thread_key: KEY, outcome: 'drafted' }]);
    expect(body.refused).toEqual([]);
    expect((await (await POST(req('POST', PATH, { items: [drafted({ draft_text: 'Thanks \u2014 yes.' })], dry: true }) as never)).json()).refused).toEqual([{ thread_key: KEY, reason: 'draft_shape' }]);
    expect(body.action_id).toBeNull();
    expect(body.line).toBeNull();
    expect(fake.writes).toEqual([]);
    expect(fake.rows.size).toBe(0);
    expect(fake.runs.size).toBe(0);
    expect(fake.actions).toHaveLength(0);
    const short = { thread_key: KEY, newest_ask_id: ASK, outcome: 'short_drafted', short_draft_id: 's', short_draft_text: 'Thanks. Got it.', model: 'haiku' };
    expect((await (await POST(req('POST', PATH, { items: [short], dry: true }) as never)).json()).refused).toEqual([{ thread_key: KEY, reason: 'no_draft' }]);
    expect(fake.writes).toEqual([]);
    const real = await (await POST(req('POST', PATH, { items: [drafted()], dry: false }) as never)).json();
    expect(real.saved).toHaveLength(1);
    expect(fake.rows.size).toBe(1);
  });
  it('dry must be a boolean, and a dry body is still strict', async () => {
    for (const b of [{ items: [drafted()], dry: 'yes' }, { items: [drafted()], dry: 1 }, { items: [drafted()], dry: null }, { items: [drafted()], dry: true, extra: 1 }]) {
      expect((await POST(req('POST', PATH, b as never) as never)).status).toBe(400);
    }
    expect(fake.writes).toEqual([]);
  });
  it('a stale ask gives a per-item 409 and nothing is written for it', async () => {
    setDb({ asks: [fakeAsk(), fakeAsk({ id: 'aaaaaaaa-0000-4000-8000-000000000009', message_id: 'm9', received_at: new Date('2026-11-06T15:00:00Z') })] });
    const res = await POST(req('POST', PATH, { items: [drafted()] }) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).refused).toEqual([{ thread_key: KEY, reason: 'stale', status: 409 }]);
    expect(fake.rows.size).toBe(0);
    expect(fake.actions).toHaveLength(0);
  });
  it('saves needs_thought, mike_edited and failed outcomes', async () => {
    const nt = { thread_key: KEY, newest_ask_id: ASK, outcome: 'needs_thought', read: 'The reply needs a price from you.', suggested_answer: null, needs_commitment: true, model: 'sonnet' };
    expect((await (await POST(req('POST', PATH, { items: [nt] }) as never)).json()).saved).toHaveLength(1);
    expect((await (await POST(req('POST', PATH, { items: [{ thread_key: KEY, newest_ask_id: ASK, outcome: 'failed', error: 'claude exited 1' }] }) as never)).json()).saved).toHaveLength(1);
    await POST(req('POST', PATH, { items: [drafted()] }) as never);
    expect((await (await POST(req('POST', PATH, { items: [{ thread_key: KEY, newest_ask_id: ASK, outcome: 'mike_edited' }] }) as never)).json()).saved).toHaveLength(1);
  });
  it('never writes an email ask, task or outbox row, and a touch of any other model throws', async () => {
    await POST(req('POST', PATH, { items: [drafted()] }) as never);
    expect(fake.writes.every((w) => /^(homeOwedThread|homeKeeperRun|homeAction)\./.test(w))).toBe(true);
    expect(() => (fake.db as unknown as Record<string, unknown>).emailOutbox).toThrow();
    expect(() => (fake.db as unknown as Record<string, unknown>).task).toThrow();
  });
  it('11 items gives 400, 10 is fine, an empty list is fine', async () => {
    const many = (n: number) => Array.from({ length: n }, () => drafted());
    expect((await POST(req('POST', PATH, { items: many(11) }) as never)).status).toBe(400);
    expect((await POST(req('POST', PATH, { items: many(10) }) as never)).status).toBe(200);
    expect((await POST(req('POST', PATH, { items: [] }) as never)).status).toBe(200);
  });
  it('a body over 64 KB gives 413', async () => {
    const res = await POST(req('POST', PATH, { items: [drafted({ draft_text: 'a'.repeat(70 * 1024) })] }) as never);
    expect(res.status).toBe(413);
    expect(fake.writes).toEqual([]);
  });
  it('refuses a bad shape with 400: extra field, user id, bad ask id, unknown outcome, not JSON', async () => {
    const bad = [
      { items: [{ ...drafted(), extra: 1 }] },
      { items: [drafted()], user_id: OWNER_ID },
      { items: [drafted({ newest_ask_id: 'nope' })] },
      { items: [drafted({ outcome: 'sent' })] },
      { items: [drafted({ thread_key: 'task:1' })] },
      { items: [{ thread_key: KEY, newest_ask_id: ASK, outcome: 'mike_edited', draft_text: 'x' }] },
      { items: 'x' },
      {},
    ];
    for (const b of bad) expect((await POST(req('POST', PATH, b) as never)).status).toBe(400);
    expect((await POST(req('POST', PATH, 'not json') as never)).status).toBe(400);
    expect(fake.writes).toEqual([]);
  });
});

describe('owed route: lane and registry', () => {
  it('both methods are on the bast-chat lane and documented', () => {
    const lane = LANE_ROUTES['bast-chat'].filter((r) => r.pattern === PATH).map((r) => r.method).sort();
    expect(lane).toEqual(['GET', 'POST']);
    const e = bastChatEndpoints.find((x) => x.path === PATH);
    expect(e?.methods.map((m) => m.method)).toEqual(['GET', 'POST']);
  });
});
