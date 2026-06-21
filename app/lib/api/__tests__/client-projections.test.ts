import { describe, it, expect } from 'vitest';
import { formatTaskForClient, formatArticleForClient } from '../client-projections';

// A task row populated with EVERY internal field we must never leak to a client.
const fullInternalTask = {
  id: 't1',
  title: 'Redesign the homepage hero',
  description: [{ type: 'paragraph', content: [{ type: 'text', text: 'Do the thing' }] }],
  status: 'in_progress',
  estimated_minutes: 120,
  created_at: '2026-06-20T10:00:00Z',
  updated_at: '2026-06-21T10:00:00Z',
  comments: [
    { id: 'c1', content: 'Looks great, ship it!', is_internal: false, created_at: '2026-06-20T11:00:00Z', user: { id: 'u1', name: 'Jane Client', email: 'jane@client.com', avatar_url: 'http://x/a.png' } },
    { id: 'c2', content: 'Bast: type-check + tests green, pushed abc123', is_internal: true, created_at: '2026-06-20T11:05:00Z', user: { id: 'ub', name: 'Bast', email: 'bast@becomeindelible.com' } },
  ],
  // --- everything below must NOT appear in the client projection ---
  priority: 1,
  energy_estimate: 'high_drain',
  mystery_factor: 3,
  battery_impact: 'average_drain',
  is_billable: true,
  billing_target: 500,
  billing_amount: 450,
  is_retainer_work: true,
  is_support: false,
  invoiced: true,
  invoiced_at: '2026-06-21T00:00:00Z',
  invoiced_by_id: 'u9',
  requirements: [{ id: 'r1', text: 'secret', completed: false }],
  review_requirements: { rubric: 'internal only' },
  source: 'email',
  source_ref: 'msgid-123',
  requested_by_contact_id: 'contact-1',
  notes: [{ type: 'paragraph', content: [{ type: 'text', text: 'internal note' }] }],
  assignee_id: 'ub',
  assignee: { id: 'ub', name: 'Bast', email: 'bast@becomeindelible.com', avatar_url: 'http://x' },
  reviewer_id: 'u2',
  reviewer: { id: 'u2', name: 'Mike' },
  created_by_id: 'u2',
  created_by: { id: 'u2', name: 'Mike' },
  approved_by_id: 'u2',
  approved: true,
  sop_id: 'sop-1',
  sop: { id: 'sop-1', title: 'Custom Development' },
  function_id: 'fn-1',
  function: { id: 'fn-1', name: 'Engineering' },
  project_id: 'p1',
  client_id: 'cl1',
  site_id: 's1',
  blocked_by: [{ id: 't0', title: 'A1' }],
  blocking: [{ id: 't3', title: 'A3' }],
  time_entries: [{ id: 'te1', duration: 90, description: 'work' }],
  sort_order: 5,
  staging_preview_url: 'https://staging.example.com',
};

const ALLOWED_TASK_KEYS = [
  'id', 'title', 'description', 'status', 'estimated_minutes', 'comments', 'created_at', 'updated_at',
].sort();

describe('formatTaskForClient', () => {
  it('exposes exactly the client-safe key set — nothing more', () => {
    const out = formatTaskForClient(fullInternalTask);
    expect(Object.keys(out).sort()).toEqual(ALLOWED_TASK_KEYS);
  });

  it('passes through the allowed fields', () => {
    const out = formatTaskForClient(fullInternalTask);
    expect(out.id).toBe('t1');
    expect(out.title).toBe('Redesign the homepage hero');
    expect(out.status).toBe('in_progress');
    expect(out.estimated_minutes).toBe(120);
    expect(out.description).toEqual(fullInternalTask.description);
    expect(out.created_at).toBe('2026-06-20T10:00:00Z');
  });

  it('leaks NONE of the internal fields', () => {
    const out = formatTaskForClient(fullInternalTask) as Record<string, unknown>;
    const forbidden = [
      'priority', 'energy_estimate', 'mystery_factor', 'battery_impact',
      'is_billable', 'billing_target', 'billing_amount', 'is_retainer_work', 'is_support',
      'invoiced', 'invoiced_at', 'invoiced_by_id', 'requirements', 'review_requirements',
      'source', 'source_ref', 'requested_by_contact_id', 'notes',
      'assignee', 'assignee_id', 'reviewer', 'reviewer_id', 'created_by', 'created_by_id',
      'approved', 'approved_by_id', 'sop', 'sop_id', 'function', 'function_id',
      'project_id', 'client_id', 'site_id', 'blocked_by', 'blocking', 'time_entries',
      'sort_order', 'staging_preview_url',
    ];
    for (const key of forbidden) {
      expect(out[key], `internal field "${key}" leaked`).toBeUndefined();
    }
  });

  it('drops internal comments and exposes only client-safe comment fields', () => {
    const out = formatTaskForClient(fullInternalTask);
    expect(out.comments).toHaveLength(1);
    const c = out.comments[0];
    expect(c.id).toBe('c1');
    expect(c.content).toBe('Looks great, ship it!');
    expect(c.author_name).toBe('Jane Client');
    expect(Object.keys(c).sort()).toEqual(['author_name', 'content', 'created_at', 'id']);
    // never exposes the internal "Bast" technical note nor email/avatar/is_internal
    const serialized = JSON.stringify(out.comments);
    expect(serialized).not.toContain('bast@becomeindelible.com');
    expect(serialized).not.toContain('avatar');
    expect(serialized).not.toContain('is_internal');
  });

  it('defaults estimated_minutes and comments when absent', () => {
    const out = formatTaskForClient({ id: 't2', title: 'x', status: 'not_started' });
    expect(out.estimated_minutes).toBeNull();
    expect(out.comments).toEqual([]);
  });
});

const fullInternalArticle = {
  id: 'a1',
  title: 'Why VT maple matters',
  status: 'ready_for_review',
  body: '# Heading\n\nbody text',
  created_at: '2026-06-20T10:00:00Z',
  updated_at: '2026-06-21T10:00:00Z',
  comments: [
    { id: 'ac1', content: 'Please tweak the intro', is_feedback: true, resolved: false, created_at: '2026-06-20T11:00:00Z', user: { id: 'u1', name: 'Jane Client', email: 'jane@client.com' } },
    { id: 'ac2', content: 'internal-only article note', is_internal: true, created_at: '2026-06-20T11:05:00Z', user: { id: 'ub', name: 'Bast' } },
  ],
  // --- must NOT leak ---
  run_id: 'r1',
  client_id: 'cl1',
  client: { id: 'cl1', name: 'Maple Co' },
  site_id: 's1',
  site: { id: 's1', name: 'maple.com' },
  slug: 'why-vt-maple',
  check_state: 'passed',
  check_report: { issues: [] },
  research_summary: 'internal research',
  social_copy: 'tweet me',
  suggested_date: '2026-07-01',
  scheduled_date: '2026-07-02',
  published_url: null,
  approved_by_id: 'u2',
  approved_by: { id: 'u2', name: 'Mike' },
  locked: true,
  claimed_at: '2026-06-20T09:00:00Z',
  claimed_by_id: 'ub',
};

const ALLOWED_ARTICLE_KEYS = [
  'id', 'title', 'status', 'body', 'comments', 'created_at', 'updated_at',
].sort();

describe('formatArticleForClient', () => {
  it('exposes exactly the client-safe key set — nothing more', () => {
    const out = formatArticleForClient(fullInternalArticle);
    expect(Object.keys(out).sort()).toEqual(ALLOWED_ARTICLE_KEYS);
  });

  it('passes through the allowed fields', () => {
    const out = formatArticleForClient(fullInternalArticle);
    expect(out.id).toBe('a1');
    expect(out.title).toBe('Why VT maple matters');
    expect(out.status).toBe('ready_for_review');
    expect(out.body).toBe('# Heading\n\nbody text');
  });

  it('leaks NONE of the internal fields', () => {
    const out = formatArticleForClient(fullInternalArticle) as Record<string, unknown>;
    const forbidden = [
      'run_id', 'client_id', 'client', 'site_id', 'site', 'slug',
      'check_state', 'check_report', 'research_summary', 'social_copy',
      'suggested_date', 'scheduled_date', 'published_url',
      'approved_by_id', 'approved_by', 'locked', 'claimed_at', 'claimed_by_id',
    ];
    for (const key of forbidden) {
      expect(out[key], `internal field "${key}" leaked`).toBeUndefined();
    }
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('internal research');
  });

  it('forward-compatibly filters is_internal article comments and shapes the rest', () => {
    const out = formatArticleForClient(fullInternalArticle);
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0].id).toBe('ac1');
    expect(out.comments[0].author_name).toBe('Jane Client');
    expect(Object.keys(out.comments[0]).sort()).toEqual(['author_name', 'content', 'created_at', 'id']);
    // is_feedback / resolved are internal workflow state — not exposed
    expect(JSON.stringify(out.comments)).not.toContain('is_feedback');
  });

  it('defaults body and comments when absent', () => {
    const out = formatArticleForClient({ id: 'a2', title: 'x', status: 'draft' });
    expect(out.body).toBeNull();
    expect(out.comments).toEqual([]);
  });
});
