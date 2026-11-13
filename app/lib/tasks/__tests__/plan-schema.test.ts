import { describe, it, expect } from 'vitest';
import { ITEM_SCHEMAS, PLAN_SECTIONS, isProjectDateLabel, patchBody, putBody } from '../plan-schema';
import { planLine, shortDay } from '../plan-summary';
import { laneAllows, LANES } from '@/lib/auth/lane-scopes';

const src = { label: 'Signed SOW, section 3', date: '2026-10-20', kind: 'document' as const };
const ok = (section: keyof typeof ITEM_SCHEMAS, v: unknown) => ITEM_SCHEMAS[section].safeParse(v).success;
const msg = (section: keyof typeof ITEM_SCHEMAS, v: unknown) => {
  const r = ITEM_SCHEMAS[section].safeParse(v);
  return r.success ? '' : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ');
};

describe('plan item validation, per section', () => {
  it('requirements: one capped line, a source, and a changed line says what it was and what changed it', () => {
    expect(ok('requirements', { text: 'Eight pages', source: src })).toBe(true);
    expect(ITEM_SCHEMAS.requirements.parse({ text: 'Eight pages', source: src }).mark).toBe('original');
    expect(ok('requirements', { text: 'Eight pages' })).toBe(false); // no source
    expect(ok('requirements', { text: 'a\nb', source: src })).toBe(false); // two lines
    expect(ok('requirements', { text: 'x'.repeat(201), source: src })).toBe(false); // capped
    expect(ok('requirements', { text: 'Eight pages', source: src, mark: 'changed' })).toBe(false);
    expect(msg('requirements', { text: 'Eight pages', source: src, mark: 'changed', was: 'Six pages' })).toContain('changed_by');
    expect(ok('requirements', { text: 'Eight pages', source: src, mark: 'changed', was: 'Six pages', changed_by: 'Dan, Nov 9 email' })).toBe(true);
    expect(ok('requirements', { text: 'Blog', source: src, mark: 'dropped' })).toBe(true);
    expect(ok('requirements', { text: 'Eight pages', source: src, mark: 'weird' })).toBe(false);
    expect(ok('requirements', { text: 'Eight pages', source: src, extra: 1 })).toBe(false); // strict
  });

  it('sources: a real date, and a link that is http, https or a path, never a script', () => {
    expect(ok('requirements', { text: 'a', source: { label: 'x', date: '2026-02-30' } })).toBe(false);
    expect(ok('requirements', { text: 'a', source: { label: 'x', url: 'javascript:alert(1)' } })).toBe(false);
    expect(ok('requirements', { text: 'a', source: { label: 'x', url: 'data:text/html,hi' } })).toBe(false);
    expect(ok('requirements', { text: 'a', source: { label: 'x', url: 'https://example.com/sow.pdf#s3' } })).toBe(true);
    expect(ok('requirements', { text: 'a', source: { label: 'x', url: '/deals/abc' } })).toBe(true);
    expect(ok('requirements', { text: 'a', source: { label: 'x', kind: 'rumor' } })).toBe(false);
  });

  it('dates: a label and a real day', () => {
    expect(ok('dates', { label: 'Staging', date: '2026-12-15', source: src })).toBe(true);
    expect(ok('dates', { label: 'Staging', date: '12/15/2026', source: src })).toBe(false);
    expect(ok('dates', { label: '', date: '2026-12-15', source: src })).toBe(false);
    expect(isProjectDateLabel('Launch')).toBe(true);
    expect(isProjectDateLabel(' project start date ')).toBe(true);
    expect(isProjectDateLabel('Design handoff')).toBe(false);
  });

  it('team: a Citadel user or a named outside party, with a role', () => {
    expect(ok('team', { person: { user_id: '3ecfb7be-20bb-43cb-9b4d-31c44337dc81' }, role: 'Approves the design' })).toBe(true);
    expect(ok('team', { person: { name: 'Lisa', org: 'Freelance designer' }, role: 'Designs the pages' })).toBe(true);
    expect(ok('team', { person: { user_id: 'nope' }, role: 'x' })).toBe(false);
    expect(ok('team', { person: { name: 'Lisa' } })).toBe(false);
  });

  it('billing: a basis with a kind and source, milestones with amount as text, a matches_citadel flag that defaults to unknown', () => {
    const basis = { type: 'basis', kind: 'milestones', source: src };
    expect(ITEM_SCHEMAS.billing.parse(basis)).toMatchObject({ matches_citadel: null });
    expect(ok('billing', { ...basis, matches_citadel: true })).toBe(true);
    expect(ok('billing', { ...basis, matches_citadel: 'yes' })).toBe(false);
    expect(ok('billing', { ...basis, kind: 'weekly' })).toBe(false);
    expect(ok('billing', { type: 'basis', kind: 'hourly' })).toBe(false); // no source
    expect(ok('billing', { type: 'milestone', label: 'Deposit', amount: '$4,500', trigger: 'On signing' })).toBe(true);
    expect(ok('billing', { type: 'milestone', label: 'Deposit', amount: 4500, trigger: 'On signing' })).toBe(false); // text exactly as stated, never a number
    expect(ok('billing', { type: 'milestone', label: 'Deposit', amount: '$4,500' })).toBe(false); // trigger needed
    expect(ok('billing', { type: 'milestone', label: 'Deposit', amount: '$4,500', trigger: 'On signing', due: '2026-13-01' })).toBe(false);
  });

  it('examples need a link, a note and a source; decisions a line and a source', () => {
    expect(ok('examples', { url: 'https://example.com', note: 'A calm product page', source: src })).toBe(true);
    expect(ok('examples', { url: 'example.com', note: 'x', source: src })).toBe(false);
    expect(ok('examples', { url: 'https://example.com', source: src })).toBe(false);
    expect(ok('decisions', { text: 'Go with the old logo', source: { label: 'Mike, typed in chat', kind: 'mike_typed' } })).toBe(true);
    expect(ok('decisions', { text: 'Go with the old logo' })).toBe(false);
  });

  it('request bodies: PUT carries items, PATCH exactly one operation', () => {
    expect(putBody.safeParse({ items: [] }).success).toBe(true);
    expect(putBody.safeParse({ rows: [] }).success).toBe(false);
    expect(patchBody.safeParse({ op: 'remove', id: '3ecfb7be-20bb-43cb-9b4d-31c44337dc81' }).success).toBe(true);
    expect(patchBody.safeParse({ op: 'remove', id: 'x' }).success).toBe(false);
    expect(patchBody.safeParse({ op: 'mark_wrong', id: '3ecfb7be-20bb-43cb-9b4d-31c44337dc81', wrong: true }).success).toBe(true);
    expect(patchBody.safeParse({ op: 'explode' }).success).toBe(false);
    expect(PLAN_SECTIONS).toEqual(['requirements', 'dates', 'team', 'billing', 'examples', 'decisions']);
  });
});

describe('the home card plan line', () => {
  const base = { requirements: 0, project_launch: null, dates: [], billing_kind: null, other_items: 0 };
  it('builds "Plan: 12 requirements, launch Jan 19, milestones billing" from the sections', () => {
    expect(planLine({ ...base, requirements: 12, project_launch: '2027-01-19', billing_kind: 'milestones', other_items: 20 })).toBe('Plan: 12 requirements, launch Jan 19, milestones billing');
  });
  it('is omitted when empty, says started when only other lines exist, and reads launch from a plan date when the project has none', () => {
    expect(planLine(base)).toBeNull();
    expect(planLine({ ...base, other_items: 2 })).toBe('Plan: started');
    expect(planLine({ ...base, requirements: 1, dates: [{ label: 'Launch', date: '2027-03-02' }] })).toBe('Plan: 1 requirement, launch Mar 2');
    expect(planLine({ ...base, billing_kind: 'internal', other_items: 1 })).toBe('Plan: not billed');
    expect(planLine({ ...base, billing_kind: 'unknown', other_items: 1 })).toBe('Plan: started');
    expect(shortDay('2027-01-19')).toBe('Jan 19');
  });
});

describe('lane scopes for the plan routes', () => {
  const GET = '/api/tasks/7f1c/plan';
  const PUT = '/api/tasks/7f1c/plan/billing';
  it('bast-chat reads and writes, dox reads and writes, the worker lane only reads', () => {
    for (const l of ['bast-chat', 'dox']) {
      expect(laneAllows(l, 'GET', GET)).toBe(true);
      expect(laneAllows(l, 'PUT', PUT)).toBe(true);
      expect(laneAllows(l, 'PATCH', PUT)).toBe(true);
    }
    expect(laneAllows('bast', 'GET', GET)).toBe(true);
    expect(laneAllows('bast', 'PUT', PUT)).toBe(false);
    expect(laneAllows('bast', 'PATCH', PUT)).toBe(false);
  });
  it('no other lane reaches the plan', () => {
    for (const l of LANES.filter((x) => !['bast-chat', 'dox', 'bast'].includes(x))) {
      for (const [m, p] of [['GET', GET], ['PUT', PUT], ['PATCH', PUT]] as const) expect(laneAllows(l, m, p), `${l} ${m}`).toBe(false);
    }
  });
});
