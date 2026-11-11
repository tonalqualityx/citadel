import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { actionSchemas, candidatesBodySchema, homeReconcileBodySchema, parseAction, reconcileBodySchema } from '../schema';

const U = '7aa4a01a-1111-4222-8333-944445555666';
const msg = (over: Record<string, unknown> = {}) => ({
  message_key: 'abc@mail.example',
  account: 'mike@becomeindelible.com',
  gmail_id: '19abc',
  thread_id: '19thread',
  thread_root: '19thread',
  sent_at: '2026-11-09T15:00:00Z',
  to_label: 'kue@griswoldcontrols.com',
  subject: 'Re: SPAM ON WEBSITE',
  lookback: false,
  bast_words: false,
  new_part: 'I removed the File Manager plugin.',
  quoted_part_hash: 'a'.repeat(64),
  filter: { model: 'haiku', cost_usd: 0.01 },
  match: { model: 'sonnet', cost_usd: 0.05 },
  outcome: 'actions',
  actions: [{ type: 'note', task_id: U, quote: 'I removed the File Manager plugin.', confidence: 'high' }],
  ...over,
});

describe('the bodies the machine job sends (reconciler.py and shape.py)', () => {
  it('a real and a dry POST share one strict body', () => {
    expect(reconcileBodySchema.safeParse({ dry: true, messages: [msg()] }).success).toBe(true);
    expect(reconcileBodySchema.safeParse({ dry: false, messages: [msg()] }).success).toBe(true);
    expect(reconcileBodySchema.safeParse({ dry: false, messages: [msg()], extra: 1 }).success).toBe(false);
    expect(reconcileBodySchema.safeParse({ dry: false, messages: [msg({ extra: 1 })] }).success).toBe(false);
    expect(reconcileBodySchema.safeParse({ messages: [msg()] }).success).toBe(false);
  });
  it('the look-back end marker is {dry:false, lookback_end:true, messages:[]} and carries no messages', () => {
    expect(reconcileBodySchema.safeParse({ dry: false, lookback_end: true, messages: [] }).success).toBe(true);
    expect(reconcileBodySchema.safeParse({ dry: false, lookback_end: true, messages: [msg()] }).success).toBe(false);
    expect(reconcileBodySchema.safeParse({ dry: false, messages: [] }).success).toBe(false);
  });
  it('at most 10 messages', () => {
    const ten = Array.from({ length: 10 }, (_, i) => msg({ message_key: `k${i}` }));
    expect(reconcileBodySchema.safeParse({ dry: true, messages: ten }).success).toBe(true);
    expect(reconcileBodySchema.safeParse({ dry: true, messages: [...ten, msg({ message_key: 'k11' })] }).success).toBe(false);
  });
  it('new_part is capped at 6,000 characters; a null match and a prefilter model are accepted', () => {
    expect(reconcileBodySchema.safeParse({ dry: true, messages: [msg({ new_part: 'x'.repeat(6001) })] }).success).toBe(false);
    expect(reconcileBodySchema.safeParse({ dry: true, messages: [msg({ match: null, filter: { model: 'none', cost_usd: 0 }, outcome: 'nothing', actions: [] })] }).success).toBe(true);
  });
  it('each action is parsed on its own: one bad action is a bad_shape refusal, not a 400', () => {
    const body = reconcileBodySchema.safeParse({ dry: true, messages: [msg({ actions: [{ type: 'note' }, { type: 'bogus' }, null] })] });
    expect(body.success).toBe(true);
    expect(parseAction({ type: 'note' })).toBeNull();
    expect(parseAction({ type: 'bogus' })).toBeNull();
    expect(parseAction(null)).toBeNull();
  });
  it('every action shape of shape.py is accepted, and no more', () => {
    const wait_on = { email: 'a@b.co', name: 'A', what: 'the logo' };
    const ok = [
      { type: 'note', task_id: U, quote: 'q', confidence: 'medium' },
      { type: 'done', task_id: U, quote: 'q', confidence: 'high', past_tense: true, remaining_open: ['x'], did_phrase: 'removed it' },
      { type: 'waiting', task_id: U, quote: 'q', confidence: 'high', past_tense: true, remaining_open: [], did_phrase: 'sent it', wait_on },
      { type: 'session', session_key: 'abc-1', quote: 'q', confidence: 'high' },
      { type: 'wait', wait_on, quote: 'q', confidence: 'high' },
      { type: 'track', title: 't', done_title: 'd', next_step: 'n', later: ['l'], client_id: null, project_id: null, minutes: 90, estimate_basis: 'six emails', quote: 'q', confidence: 'high' },
    ];
    for (const a of ok) expect(parseAction(a), JSON.stringify(a)).not.toBeNull();
    // done with a wait_on, an extra field and a bad minutes are all bad shapes
    expect(parseAction({ ...ok[1], wait_on })).toBeNull();
    expect(parseAction({ ...ok[0], extra: 1 })).toBeNull();
    expect(parseAction({ ...ok[5], minutes: 1.5 })).toBeNull();
    expect(parseAction({ ...ok[5], minutes: 2000 })).toBeNull();
    expect(parseAction({ ...ok[0], quote: 'x'.repeat(401) })).toBeNull();
    expect(Object.keys(actionSchemas).sort()).toEqual(['done', 'note', 'session', 'track', 'wait', 'waiting']);
  });
  it('the candidates body matches candidates_request()', () => {
    const body = {
      messages: [
        { message_key: 'k', account: 'mike@becomeindelible.com', thread_id: 't', thread_rfc_ids: ['a@b'], to: [{ email: 'kue@x.co', name: '' }], cc: [], subject: 's', sent_at: '2026-11-09T15:00:00Z' },
      ],
    };
    expect(candidatesBodySchema.safeParse(body).success).toBe(true);
    expect(candidatesBodySchema.safeParse({ messages: [{ ...body.messages[0], extra: 1 }] }).success).toBe(false);
    expect(candidatesBodySchema.safeParse({ messages: Array.from({ length: 11 }, () => body.messages[0]) }).success).toBe(false);
  });
  it('POST /api/home/reconcile bodies are strict', () => {
    const key = `proposal:${U}`;
    expect(homeReconcileBodySchema.safeParse({ action: 'track_it', item_key: key, placement: 'project', minutes: 90, billable: true }).success).toBe(true);
    expect(homeReconcileBodySchema.safeParse({ action: 'track_it', item_key: key, placement: 'elsewhere', minutes: 90, billable: true }).success).toBe(false);
    expect(homeReconcileBodySchema.safeParse({ action: 'track_it', item_key: key, placement: 'none', minutes: null, billable: false, user_id: U }).success).toBe(false);
    expect(homeReconcileBodySchema.safeParse({ action: 'log_time', task_id: U, minutes: 30, day: '2026-11-10' }).success).toBe(true);
    expect(homeReconcileBodySchema.safeParse({ action: 'log_time', task_id: U, minutes: 0, day: '2026-11-10' }).success).toBe(false);
    expect(homeReconcileBodySchema.safeParse({ action: 'proposal_yes', item_key: key, minutes: null }).success).toBe(true);
  });
});

describe('the machine job and this server agree on the field names', () => {
  const SHAPE = '/home/mike/.claude/tools/sent-reconciler/shape.py';
  const shapePy = existsSync(SHAPE) ? readFileSync(SHAPE, 'utf8') : '';
  it.skipIf(!shapePy)('every key shape.py requires for an action is a key of the server schema (skipped when the job is not on this machine)', () => {
    const keysOf = (t: string): string[] => {
      const m = shapePy.match(new RegExp(`"${t}": \\{([^}]*)\\}`));
      return m ? [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort() : [];
    };
    for (const t of ['note', 'done', 'waiting', 'session', 'wait', 'track'] as const) {
      const want = keysOf(t);
      expect(want.length).toBeGreaterThan(0);
      const have = Object.keys((actionSchemas[t] as unknown as { shape: Record<string, unknown> }).shape).sort();
      expect(have).toEqual(want);
    }
  });
});

describe('optional mirror facts on a real or dry message', () => {
  it('accepts to, cc and at most 60 thread_rfc_ids of at most 300 characters, and stays strict', () => {
    const ok = { to: [{ email: 'a@b.co', name: '' }], cc: [], thread_rfc_ids: ['x'.repeat(300)] };
    expect(reconcileBodySchema.safeParse({ dry: true, messages: [msg(ok)] }).success).toBe(true);
    expect(reconcileBodySchema.safeParse({ dry: true, messages: [msg()] }).success).toBe(true);
    expect(reconcileBodySchema.safeParse({ dry: true, messages: [msg({ thread_rfc_ids: Array.from({ length: 61 }, () => 'a') })] }).success).toBe(false);
    expect(reconcileBodySchema.safeParse({ dry: true, messages: [msg({ thread_rfc_ids: ['x'.repeat(301)] })] }).success).toBe(false);
    expect(reconcileBodySchema.safeParse({ dry: true, messages: [msg({ cc: [{ email: 'a@b.co', name: '', x: 1 }] })] }).success).toBe(false);
  });
});
