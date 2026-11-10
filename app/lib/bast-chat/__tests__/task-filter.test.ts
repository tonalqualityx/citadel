import { describe, it, expect } from 'vitest';
import { filterChatTaskBody, CHAT_PATCH_ALLOWED, type ChatFilterInput, type ChatFilterResult } from '../task-filter';

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
const BAST = 'ca5335e7-0000-4000-8000-000000000002';
const chat = { lane: 'bast-chat', laneEnforced: true };
const mine = { assignee_id: OWNER };

const patch = (body: unknown, existing: Existing = mine, auth: Auth = chat) =>
  filterChatTaskBody({ auth, method: 'PATCH', body, ownerId: OWNER, existing });
const post = (body: unknown, auth: Auth = chat) => filterChatTaskBody({ auth, method: 'POST', body, ownerId: OWNER });

const refusedField = (res: ChatFilterResult, field: string) => {
  const r = refusal(res);
  expect(r.status).toBe(403);
  expect(r.code).toBe('chat_field_refused');
  expect(r.message).toContain(field);
  expect(r.message).not.toMatch(/\n/);
};

describe('PATCH allowlist for the chat lane', () => {
  it('allows each permitted field alone and together', () => {
    for (const body of [
      { status: 'not_started' }, { status: 'in_progress' }, { status: 'blocked' }, { status: 'done' }, { status: 'abandoned' },
      { title: 'New title' }, { arc_id: '5f1c1c1c-0000-4000-8000-000000000003' }, { arc_id: null },
      { assignee_id: OWNER }, { due_date: null },
      { status: 'done', title: 'x', arc_id: null, assignee_id: OWNER },
    ]) {
      const r = accepted(patch(body));
      expect(r.body).toBe(body);
    }
    expect(CHAT_PATCH_ALLOWED).toEqual(['status', 'title', 'arc_id', 'assignee_id', 'due_date']);
  });

  it('refuses status review and unknown statuses', () => {
    refusedField(patch({ status: 'review' }), 'status');
    refusedField(patch({ status: 'bogus' }), 'status');
  });

  it.each([
    'client_approved_at', 'approved_by_contact_id', 'approval_source', 'client_visible', 'approved', 'staging_preview_url',
    'staging_deployed_at', 'tags', 'priority', 'is_focus', 'is_billable', 'billing_target', 'billing_amount', 'is_retainer_work',
    'is_support', 'project_id', 'client_id', 'site_id', 'is_deleted', 'deleted_at', 'blocked_by_ids',
    'needs_review', 'hard_due_at', 'hard_due_source',
  ])('refuses %s, naming it', (field) => {
    refusedField(patch({ title: 'ok', [field]: 'x' }), field);
    refusedField(patch({ [field]: null }), field);
  });

  describe('description, requirements and origin_url', () => {
    const filed = { assignee_id: OWNER, tags: ['from-chat'] };
    const body = { description: [], requirements: [{ id: 'a', text: 'x' }], origin_url: 'https://example.com/c/1' };
    it('are allowed on a task the chat filed', () => {
      expect(accepted(patch(body, filed)).body).toBe(body);
      for (const k of Object.keys(body)) expect(patch({ [k]: (body as Record<string, unknown>)[k] }, filed).ok).toBe(true);
    });
    it('are refused on an owner task without the from-chat tag', () => {
      for (const existing of [mine, { assignee_id: OWNER, tags: [] }, { assignee_id: OWNER, tags: ['bast-doable'] }]) {
        for (const k of Object.keys(body)) refusedField(patch({ [k]: (body as Record<string, unknown>)[k] }, existing), k);
      }
    });
    it('are refused on someone else\'s task, even if tagged', () => {
      for (const k of Object.keys(body)) {
        const r = refusal(patch({ [k]: (body as Record<string, unknown>)[k] }, { assignee_id: BAST, tags: ['from-chat'] }));
        expect(r.code).toBe('chat_not_owner_task');
      }
    });
    it('still refuse other forbidden fields on a from-chat task and bad types', () => {
      refusedField(patch({ description: [], client_approved_at: 'x' }, filed), 'client_approved_at');
      refusedField(patch({ requirements: 'x' }, filed), 'requirements');
      refusedField(patch({ origin_url: 5 }, filed), 'origin_url');
    });
  });

  it('refuses a due date value, accepts only clearing it', () => {
    refusedField(patch({ due_date: '2026-12-01T00:00:00.000Z' }), 'due_date');
  });

  it('refuses assigning to anyone but the owner', () => {
    refusedField(patch({ assignee_id: BAST }), 'assignee_id');
    refusedField(patch({ assignee_id: null }), 'assignee_id');
  });

  it('refuses a wrong-typed title or arc', () => {
    refusedField(patch({ title: 5 }), 'title');
    refusedField(patch({ arc_id: 5 }), 'arc_id');
  });

  it('refuses edits on a task not assigned to the owner', () => {
    for (const existing of [{ assignee_id: BAST }, { assignee_id: null }, {}, null]) {
      const r = refusal(patch({ status: 'done' }, existing));
      expect(r.code).toBe('chat_not_owner_task');
    }
  });

  it('allows taking a task back to the owner only as the sole change', () => {
    const body = { assignee_id: OWNER };
    const r = accepted(patch(body, { assignee_id: BAST }));
    expect(r.body).toBe(body);
    expect(refusal(patch({ assignee_id: OWNER, status: 'done' }, { assignee_id: BAST })).code).toBe('chat_not_owner_task');
    expect(refusal(patch({ assignee_id: BAST }, { assignee_id: BAST })).code).toBe('chat_not_owner_task');
  });

  it('refuses a non-object body', () => {
    expect(patch(null).ok).toBe(false);
    expect(patch([]).ok).toBe(false);
    expect(patch('x').ok).toBe(false);
  });
});

describe('POST allowlist for the chat lane', () => {
  const base = { title: 'Do a thing', assignee_id: OWNER, tags: ['from-chat'] };

  it('allows the base body and the create-task.py shape', () => {
    expect(accepted(post(base)).body).toBe(base);
    const full = {
      ...base, description: [], client_id: 'c', site_id: 's', sop_id: 'o', project_id: 'p', arc_id: 'a',
      energy_estimate: 1, mystery_factor: 'average', battery_impact: 'energizing', priority: 3, is_focus: false, needs_review: false,
    };
    expect(post(full).ok).toBe(true);
  });

  it('drops due_date and says so, without touching the input', () => {
    const input = { ...base, due_date: '2026-11-15T00:00:00.000Z' };
    const r = accepted(post(input));
    expect(r.dropped).toEqual(['due_date']);
    expect(r.body).toEqual(base);
    expect(input.due_date).toBeDefined();
  });

  it('requires the owner as assignee', () => {
    refusedField(post({ title: 't', tags: ['from-chat'] }), 'assignee_id');
    refusedField(post({ ...base, assignee_id: BAST }), 'assignee_id');
    refusedField(post({ ...base, assignee_id: null }), 'assignee_id');
  });

  it('requires tags to be exactly from-chat', () => {
    refusedField(post({ title: 't', assignee_id: OWNER }), 'tags');
    refusedField(post({ ...base, tags: [] }), 'tags');
    refusedField(post({ ...base, tags: ['from-chat', 'bast-doable'] }), 'tags');
    refusedField(post({ ...base, tags: ['bast-doable'] }), 'tags');
    refusedField(post({ ...base, tags: 'from-chat' }), 'tags');
  });

  it.each([
    'client_approved_at', 'approved_by_contact_id', 'approval_source', 'client_visible', 'approved', 'staging_preview_url',
    'staging_deployed_at', 'status', 'is_billable', 'billing_target', 'billing_amount', 'is_retainer_work', 'is_support',
    'accord_id', 'charter_id', 'source', 'source_ref', 'requested_by_contact_id', 'blocked_by_ids', 'promised_to', 'function_id',
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
      expect(refusal(patch({ status: 'done' }, mine, auth)).code).toBe('chat_lane_refused');
      expect(post({ title: 't', assignee_id: OWNER, tags: ['from-chat'] }, auth).ok).toBe(false);
    }
  });

  it('refuses when no owner is configured', () => {
    expect(filterChatTaskBody({ auth: chat, method: 'POST', body: { title: 't' }, ownerId: null }).ok).toBe(false);
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
    { client_approved_at: '2026-11-10T00:00:00.000Z', tags: ['x'], assignee_id: BAST, priority: 1 },
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
