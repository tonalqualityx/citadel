import { describe, it, expect } from 'vitest';
import {
  filterChatTaskBody, CHAT_PATCH_FIELDS, CHAT_CLOSED_FIELDS, CHAT_POST_ALLOWED, CLOSED_FIELD_TEXT, SECURITY_TAG_TEXT, HAND_TO_BAST_TEXT,
  type ChatFilterInput, type ChatFilterResult,
} from '../task-filter';
import { BAST_USER_ID } from '../gate-mirror';
import { REFUSED_FIELD_TEXT, taskInputSchema } from '../actions';

type Refusal = Extract<ChatFilterResult, { ok: false }>;
type Accepted = Extract<ChatFilterResult, { ok: true }>;
const refusal = (r: ChatFilterResult): Refusal => {
  if (r.ok) throw new Error('expected a refusal');
  return r;
};
const accepted = (r: ChatFilterResult): Accepted => {
  if (!r.ok) throw new Error(`expected acceptance, got: ${r.message}`);
  return r;
};
type Auth = ChatFilterInput['auth'];
type Existing = ChatFilterInput['existing'];

const OWNER = '3ecfb7be-0000-4000-8000-000000000001';
const BAST = BAST_USER_ID;
const SABEEN = 'b565b492-cdea-497b-a13d-85f003916bf9';
const TASK = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const chat = { lane: 'bast-chat', laneEnforced: true };
const theirs: Existing = { id: TASK, assignee_id: SABEEN, tags: ['seo', 'security'] };

const patch = (body: unknown, existing: Existing = theirs, auth: Auth = chat) =>
  filterChatTaskBody({ auth, method: 'PATCH', body, ownerId: OWNER, existing });
const post = (body: unknown, auth: Auth = chat) => filterChatTaskBody({ auth, method: 'POST', body, ownerId: OWNER });

const refusedField = (res: ChatFilterResult, field: string) => {
  const r = refusal(res);
  expect(r.status).toBe(403);
  expect(r.code).toBe('chat_field_refused');
  expect(r.message).toContain(field);
  expect(r.message).not.toMatch(/\n/);
  return r;
};

describe('the plan sentences are the actions module\'s', () => {
  it('the closed-field line is the same sentence', () => {
    expect(CLOSED_FIELD_TEXT).toBe(REFUSED_FIELD_TEXT);
  });
});

describe('PATCH: every field in the table is open on someone else\'s task, with its own validation', () => {
  const ok: [string, unknown][] = [
    ['status', 'not_started'], ['status', 'in_progress'], ['status', 'review'], ['status', 'done'], ['status', 'blocked'], ['status', 'abandoned'],
    ['title', 'A new title'], ['description', 'Plain text or **Markdown**'], ['description', null], ['notes', 'Internal note'], ['notes', null],
    ['requirements', [{ id: 'a', text: 'Do it', sort_order: 0 }]],
    ['requirements', [{ id: 's', type: 'section', title: 'Part', sort_order: 0, items: [{ id: 'a', text: 'x', sort_order: 0 }] }]], ['requirements', null],
    ['assignee_id', OWNER], ['assignee_id', SABEEN], ['assignee_id', BAST], ['assignee_id', null],
    ['project_id', OTHER], ['project_id', null], ['client_id', OTHER], ['client_id', null], ['site_id', OTHER], ['site_id', null],
    ['arc_id', OTHER], ['arc_id', null], ['energy_estimate', 3], ['energy_estimate', null], ['mystery_factor', 'significant'],
    ['battery_impact', 'energizing'], ['due_date', '2026-12-01T22:00:00.000Z'], ['due_date', null], ['promised_to', 'Jill'], ['promised_to', null],
    ['priority', 1], ['priority', 5], ['is_focus', true], ['needs_review', true], ['approved', true], ['client_visible', false], ['client_visible', true],
    ['blocked_by_ids', { connect: [OTHER] }], ['blocked_by_ids', { disconnect: [OTHER] }], ['blocked_by_ids', { connect: [OTHER], disconnect: [SABEEN] }],
  ];
  it.each(ok)('%s = %j passes and the body is returned as it was', (k, v) => {
    const body = { [k]: v };
    const r = accepted(patch(body));
    expect(r.body).toBe(body);
  });

  it('the table is exactly the allowlist (a field not in it is refused)', () => {
    expect([...CHAT_PATCH_FIELDS].sort()).toEqual([
      'approved', 'arc_id', 'assignee_id', 'battery_impact', 'blocked_by_ids', 'client_id', 'client_visible', 'description', 'due_date',
      'energy_estimate', 'is_focus', 'mystery_factor', 'needs_review', 'notes', 'origin_url', 'priority', 'project_id', 'promised_to', 'requirements',
      'site_id', 'status', 'tags_add', 'tags_remove', 'title',
    ]);
  });

  it('every open field is one the plan body of the proposal and the tap accepts (no drift between the two)', () => {
    const sample: Record<string, unknown> = {
      status: 'done', title: 't', description: 'd', notes: 'n', requirements: [], assignee_id: OWNER, project_id: OTHER, client_id: OTHER, site_id: OTHER,
      arc_id: OTHER, energy_estimate: 2, mystery_factor: 'none', battery_impact: 'average_drain', due_date: '2026-12-01T22:00:00.000Z', promised_to: 'x',
      priority: 2, is_focus: true, blocked_by_ids: { connect: [OTHER] }, needs_review: true, approved: true, client_visible: true, tags: ['a'],
    };
    for (const k of CHAT_PATCH_FIELDS) {
      if (k === 'origin_url') continue; // not a task column: the gate keeps it out of the plan (tested through the route)
      const key = k === 'tags_add' || k === 'tags_remove' ? 'tags' : k;
      expect(taskInputSchema.safeParse({ task_id: TASK, body: { [key]: sample[key] } }).success, key).toBe(true);
    }
  });

  it('refuses a status that is not one of the six, and wrong types', () => {
    refusedField(patch({ status: 'bogus' }), 'status');
    refusedField(patch({ title: 5 }), 'title');
    refusedField(patch({ title: '   ' }), 'title');
    refusedField(patch({ title: 'a\nb' }), 'title');
    refusedField(patch({ title: 'x'.repeat(201) }), 'title');
    refusedField(patch({ description: 'x'.repeat(4001) }), 'description');
    refusedField(patch({ description: 5 }), 'description');
    refusedField(patch({ requirements: 'x' }), 'requirements');
    refusedField(patch({ requirements: [{ nope: 1 }] }), 'requirements');
    refusedField(patch({ assignee_id: 'not-a-uuid' }), 'assignee_id');
    refusedField(patch({ arc_id: 5 }), 'arc_id');
    refusedField(patch({ energy_estimate: 9 }), 'energy_estimate');
    refusedField(patch({ mystery_factor: 'x' }), 'mystery_factor');
    refusedField(patch({ due_date: 'tomorrow' }), 'due_date');
    refusedField(patch({ promised_to: 'x'.repeat(201) }), 'promised_to');
    refusedField(patch({ priority: 0 }), 'priority');
    refusedField(patch({ is_focus: 'yes' }), 'is_focus');
    refusedField(patch({ client_visible: 1 }), 'client_visible');
    refusedField(patch({ blocked_by_ids: { connect: ['x'] } }), 'blocked_by_ids');
    refusedField(patch({ blocked_by_ids: { connect: [TASK] } }), 'blocked_by_ids');
    refusedField(patch({ blocked_by_ids: { other: [] } }), 'blocked_by_ids');
  });

  it('a task on Bast, on Mike, on nobody, or with no assignee read is the same: nothing about ownership is refused here', () => {
    for (const existing of [{ assignee_id: BAST }, { assignee_id: OWNER }, { assignee_id: null }, {}, null]) {
      expect(patch({ title: 'x' }, existing).ok).toBe(true);
    }
  });
});

describe('PATCH: origin_url and description blocks (create-task.py\'s follow-up)', () => {
  const filed = { id: TASK, assignee_id: OWNER, tags: ['from-chat'] };
  const body = { requirements: [{ id: 'r', text: 'x', sort_order: 0 }], description: [{ id: 'b', type: 'paragraph', content: [], children: [] }], origin_url: 'https://mail.google.com/x' };
  it('passes on a task that is the owner\'s and tagged from-chat', () => {
    expect(accepted(patch(body, filed)).body).toBe(body);
  });
  it('is refused, naming the field, on any other task', () => {
    for (const existing of [theirs, { id: TASK, assignee_id: OWNER, tags: [] }, { id: TASK, assignee_id: SABEEN, tags: ['from-chat'] }, null]) {
      refusedField(patch({ origin_url: 'https://x.test' }, existing), 'origin_url');
    }
  });
  it('is refused when it is not text or is longer than the column', () => {
    refusedField(patch({ origin_url: 5 }, filed), 'origin_url');
    refusedField(patch({ origin_url: 'x'.repeat(1001) }, filed), 'origin_url');
  });
});

describe('PATCH: the closed fields are refused, naming the field and giving the plan sentence', () => {
  it.each([...CHAT_CLOSED_FIELDS])('%s', (field) => {
    for (const body of [{ [field]: 'x' }, { title: 'ok', [field]: null }]) {
      const r = refusedField(patch(body), field);
      expect(r.message).toContain(CLOSED_FIELD_TEXT);
    }
  });

  it('names every field the plan closes', () => {
    for (const f of [
      'client_approved_at', 'approved_by_contact_id', 'approval_source', 'staging_preview_url', 'staging_deployed_at', 'source', 'source_ref',
      'requested_by_contact_id', 'review_requirements', 'reviewer_id', 'is_billable', 'billing_target', 'billing_amount', 'is_retainer_work',
      'is_support', 'function_id', 'phase', 'sort_order', 'hard_due_at', 'hard_due_source',
    ]) expect(CHAT_CLOSED_FIELDS as readonly string[]).toContain(f);
  });

  it.each(['is_deleted', 'deleted_at', 'sop_id', 'no_time_needed', 'created_by_id', 'completed_at', 'a_column_added_next_year', 'id', 'tags'])(
    'a field that is not in the table is refused too: %s',
    (field) => {
      refusedField(patch({ [field]: 'x' }), field);
      refusedField(patch({ title: 'ok', [field]: 'x' }), field);
    },
  );
});

describe('PATCH: tags_add and tags_remove become the full list, from the row read', () => {
  it('adds and removes against the stored tags, and drops the two keys', () => {
    const r = accepted(patch({ tags_add: ['lifeline', 'seo'], tags_remove: ['seo'], title: 'x' }, { id: TASK, assignee_id: SABEEN, tags: ['seo', 'keep'] }));
    expect(r.body).toEqual({ title: 'x', tags: ['keep', 'lifeline', 'seo'] });
  });
  it('removes a blocking tag and any ordinary tag', () => {
    expect(accepted(patch({ tags_remove: ['needs-mike'] }, { id: TASK, tags: ['needs-mike', 'a'] })).body).toEqual({ tags: ['a'] });
  });
  it('never adds or removes the approval machinery or from-chat', () => {
    for (const t of ['client-approved', 'cp:abc', 'preview-notified:x', 'from-chat', 'Client-Approved']) {
      expect(refusal(patch({ tags_add: [t] })).message).toContain(CLOSED_FIELD_TEXT);
      refusedField(patch({ tags_add: [t] }), 'tags_add');
      refusedField(patch({ tags_remove: [t] }, { id: TASK, tags: [t] }), 'tags_remove');
    }
  });
  it('never removes a security tag, with the plan sentence; adding one is fine', () => {
    for (const t of ['security', 'security-report', 'Security']) {
      const r = refusedField(patch({ tags_remove: [t] }), 'tags_remove');
      expect(r.message).toContain(SECURITY_TAG_TEXT);
    }
    expect(patch({ tags_add: ['security'] }).ok).toBe(true);
  });
  it('refuses a full tags list: the chat sends adds and removes', () => {
    refusedField(patch({ tags: ['a'] }), 'tags');
  });
  it('refuses bad tag input', () => {
    refusedField(patch({ tags_add: 'x' }), 'tags_add');
    refusedField(patch({ tags_remove: [''] }), 'tags_remove');
    refusedField(patch({ tags_add: Array.from({ length: 11 }, (_, i) => `t${i}`) }), 'tags_add');
  });
});

describe('PATCH: a body with nothing in it', () => {
  it('an empty body is accepted here (the guard answers "nothing to change") and a non-object is refused', () => {
    expect(patch({}).ok).toBe(true);
    for (const b of [null, [], 'x']) expect(patch(b).ok).toBe(false);
  });
});

describe('POST allowlist for the chat lane', () => {
  const base = { title: 'Do a thing', assignee_id: OWNER, tags: ['from-chat'] };

  it('allows the base body and the create-task.py shape', () => {
    expect(accepted(post(base)).body).toBe(base);
    const full = {
      ...base, description: [], client_id: 'c', site_id: 's', sop_id: 'o', project_id: 'p', arc_id: 'a',
      energy_estimate: 1, mystery_factor: 'average', battery_impact: 'energizing', priority: 3, is_focus: false, needs_review: false, promised_to: 'Jill',
    };
    expect(post(full).ok).toBe(true);
    for (const k of Object.keys(full)) expect(CHAT_POST_ALLOWED as readonly string[]).toContain(k);
  });

  it('allows any other person as the assignee, and up to four more ordinary tags', () => {
    expect(post({ ...base, assignee_id: SABEEN }).ok).toBe(true);
    expect(post({ ...base, tags: ['from-chat', 'a', 'b', 'c', 'd'] }).ok).toBe(true);
  });

  it('refuses Bast as the assignee with the hand-over sentence', () => {
    const r = refusedField(post({ ...base, assignee_id: BAST }), 'assignee_id');
    expect(r.message).toContain(HAND_TO_BAST_TEXT);
  });

  it('drops due_date and says so, without touching the input', () => {
    const input = { ...base, due_date: '2026-11-15T00:00:00.000Z' };
    const r = accepted(post(input));
    expect(r.dropped).toEqual(['due_date']);
    expect(r.body).toEqual(base);
    expect(input.due_date).toBeDefined();
  });

  it('requires an assignee', () => {
    refusedField(post({ title: 't', tags: ['from-chat'] }), 'assignee_id');
    refusedField(post({ ...base, assignee_id: null }), 'assignee_id');
    refusedField(post({ ...base, assignee_id: 'nobody' }), 'assignee_id');
  });

  it('requires from-chat exactly once and at most four others', () => {
    refusedField(post({ title: 't', assignee_id: OWNER }), 'tags');
    refusedField(post({ ...base, tags: [] }), 'tags');
    refusedField(post({ ...base, tags: ['bast-doable'] }), 'tags');
    refusedField(post({ ...base, tags: 'from-chat' }), 'tags');
    refusedField(post({ ...base, tags: ['from-chat', 'from-chat'] }), 'tags');
    refusedField(post({ ...base, tags: ['from-chat', 'a', 'b', 'c', 'd', 'e'] }), 'tags');
  });

  it('never adds an approval tag on create', () => {
    for (const t of ['client-approved', 'cp:1', 'preview-notified:x']) refusedField(post({ ...base, tags: ['from-chat', t] }), 'tags');
  });

  it.each([
    'client_approved_at', 'approved_by_contact_id', 'approval_source', 'client_visible', 'approved', 'staging_preview_url',
    'staging_deployed_at', 'status', 'is_billable', 'billing_target', 'billing_amount', 'is_retainer_work', 'is_support',
    'accord_id', 'charter_id', 'source', 'source_ref', 'requested_by_contact_id', 'blocked_by_ids', 'function_id',
    'is_deleted', 'hard_due_at',
  ])('refuses %s, naming it', (field) => {
    refusedField(post({ ...base, [field]: 'x' }), field);
  });

  it('refuses non-default priority, focus and review flags', () => {
    refusedField(post({ ...base, priority: 1 }), 'priority');
    refusedField(post({ ...base, is_focus: true }), 'is_focus');
    refusedField(post({ ...base, needs_review: true }), 'needs_review');
  });
});

describe('the lane key itself', () => {
  it('refuses a bast-chat lane key without laneEnforced', () => {
    for (const auth of [{ lane: 'bast-chat' }, { lane: 'bast-chat', laneEnforced: false }]) {
      expect(refusal(patch({ status: 'done' }, theirs, auth)).code).toBe('chat_lane_refused');
      expect(post({ title: 't', assignee_id: OWNER, tags: ['from-chat'] }, auth).ok).toBe(false);
    }
  });

  it('refuses when no owner is configured', () => {
    expect(filterChatTaskBody({ auth: chat, method: 'POST', body: { title: 't' }, ownerId: null }).ok).toBe(false);
    expect(filterChatTaskBody({ auth: chat, method: 'PATCH', body: { title: 't' }, ownerId: null }).ok).toBe(false);
  });
});

describe('every other caller passes through identical', () => {
  const callers: Array<[string, Auth]> = ([
    ['session admin', { userId: 'u', role: 'admin', via: 'session' }],
    ['session tech', { userId: 'u', role: 'tech', via: 'session' }],
    ['ordinary api key', { userId: 'u', role: 'pm', via: 'api_key' }],
    ['no lane enforced', { userId: 'u', role: 'pm', via: 'api_key', laneEnforced: true }],
    ['design-worker lane', { userId: 'u', role: 'pm', via: 'api_key', lane: 'design-worker', laneEnforced: true }],
    ['bast lane', { userId: 'u', role: 'pm', via: 'api_key', lane: 'bast', laneEnforced: false }],
  ] as Array<[string, object]>) as Array<[string, Auth]>;
  const bodies: unknown[] = [
    { client_approved_at: '2026-11-10T00:00:00.000Z', tags: ['x'], assignee_id: BAST, priority: 1, tags_remove: ['security'] },
    {}, [], null, 'text',
  ];
  it.each(callers)('%s', (_n, auth) => {
    for (const method of ['POST', 'PATCH'] as const) {
      for (const body of bodies) {
        const r = accepted(filterChatTaskBody({ auth, method, body, existing: { assignee_id: BAST } }));
        expect(r.body).toBe(body);
        expect(r.dropped).toBeUndefined();
      }
    }
  });
});
