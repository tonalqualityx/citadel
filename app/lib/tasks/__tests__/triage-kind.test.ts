import { describe, it, expect } from 'vitest';
import { planRelease, RELEASE_REFUSALS, TRIAGE_KINDS, type ReleaseInput } from '../triage-kind';

const BAST = 'bast-id';
const P = (status: string) => ({ id: 'p1', name: 'Stronghold', status });
const base = (over: Partial<ReleaseInput>): ReleaseInput => ({ kind: 'task', assignee_id: null, assignee_name: null, project: null, bast_id: BAST, ...over });

describe('planRelease: the line and the effects come from one function', () => {
  it('no kind: not ready, the line says Not sorted yet, no effects', () => {
    const r = planRelease(base({ kind: null }));
    expect(r).toMatchObject({ ready: false, block: 'unsorted', line: 'Not sorted yet', effects: null });
  });

  it('project_setup on a queue project: makes it ready, hands the card to Bast, tags kickoff and from-triage', () => {
    const r = planRelease(base({ kind: 'project_setup', project: P('queue'), assignee_id: 'someone' }));
    expect(r.ready).toBe(true);
    expect(r.effects).toEqual({ to_status: 'not_started', assign_bast: true, add_tags: ['kickoff', 'from-triage'], project_to_ready: true });
    expect(r.line).toContain('Makes Stronghold ready');
    expect(r.line).toContain('assigned to Bast');
    expect(r.line).toContain('kickoff and from-triage');
  });

  it('project_setup on an already live project does not promise to make it ready', () => {
    const r = planRelease(base({ kind: 'project_setup', project: P('in_progress') }));
    expect(r.effects?.project_to_ready).toBe(false);
    expect(r.line).not.toContain('Makes Stronghold ready');
    expect(r.line).toContain('already in progress');
  });

  it('project_setup is refused for a quote project, no project, and a closed project, and the line says why', () => {
    expect(planRelease(base({ kind: 'project_setup', project: P('quote') }))).toMatchObject({ ready: false, block: 'still_quote', effects: null });
    expect(planRelease(base({ kind: 'project_setup', project: P('quote') })).line).toContain('still a quote');
    expect(planRelease(base({ kind: 'project_setup' }))).toMatchObject({ ready: false, block: 'no_project' });
    for (const s of ['cancelled', 'done', 'suspended']) expect(planRelease(base({ kind: 'project_setup', project: P(s) }))).toMatchObject({ ready: false, block: 'project_closed' });
  });

  it('task, project_addition, reusable_tool, rule_proposal: not_started, Bast only when nobody is assigned, tag from-triage', () => {
    for (const kind of ['task', 'project_addition', 'reusable_tool', 'rule_proposal'] as const) {
      const none = planRelease(base({ kind }));
      expect(none.effects).toEqual({ to_status: 'not_started', assign_bast: true, add_tags: ['from-triage'], project_to_ready: false });
      expect(none.line).toContain('assigned to Bast');
      const owned = planRelease(base({ kind, assignee_id: 'u1', assignee_name: 'Sabeen' }));
      expect(owned.effects?.assign_bast).toBe(false);
      expect(owned.line).toContain('assigned to Sabeen');
      expect(planRelease(base({ kind, assignee_id: BAST })).line).toContain('assigned to Bast');
    }
  });

  it('project_addition names its project; a quote project refuses every non-setup kind', () => {
    expect(planRelease(base({ kind: 'project_addition', project: P('queue') })).line).toContain('on Stronghold');
    for (const kind of ['task', 'project_addition', 'reusable_tool', 'rule_proposal'] as const) {
      expect(planRelease(base({ kind, project: P('quote') }))).toMatchObject({ ready: false, block: 'still_quote' });
    }
  });

  it('question_only closes as done and promises the answers stay', () => {
    const r = planRelease(base({ kind: 'question_only', assignee_id: 'u1' }));
    expect(r.effects).toEqual({ to_status: 'done', assign_bast: false, add_tags: [], project_to_ready: false });
    expect(r.line).toBe('Closes the card as done. The questions and answers stay on it.');
  });

  it('every ready plan has effects and every blocked plan has a refusal with a plain sentence', () => {
    for (const kind of [...TRIAGE_KINDS, null]) {
      const r = planRelease(base({ kind, project: P('queue') }));
      expect(r.ready).toBe(r.effects !== null);
      expect(r.ready).toBe(r.block === null);
    }
    for (const b of Object.values(RELEASE_REFUSALS)) {
      expect(b.status).toBe(409);
      expect(b.message).not.toMatch(/[–—]/);
    }
    expect(RELEASE_REFUSALS.still_quote.message).toBe('That project is still a quote. Nothing was released.');
  });
});
