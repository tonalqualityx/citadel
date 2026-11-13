import { describe, it, expect } from 'vitest';
import { planRelease, pmReleaseHold, PM_RELEASE_TAG, RELEASE_REFUSALS, TRIAGE_KINDS, type ReleaseInput } from '../triage-kind';

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

describe('planRelease: questions, site and the worker hold (review fixes)', () => {
  const SITE = { id: 's1', name: 'stronghold.example' };

  it('says how many questions go ahead and how many wait, and that the card is flagged until answered', () => {
    const r = planRelease(base({ kind: 'task', open_go: 2, open_wait: 1 }));
    expect(r.line).toContain('2 open questions go ahead with the recommendation.');
    expect(r.line).toContain('1 will wait for you, and the card is flagged for you until it is answered.');
    expect(planRelease(base({ kind: 'task', open_go: 1 })).line).toContain('1 open question goes ahead with the recommendation.');
    expect(planRelease(base({ kind: 'task' })).line).not.toContain('open question');
    expect(planRelease(base({ kind: 'question_only', open_go: 1, open_wait: 2 })).line).toBe('Closes the card as done. The questions and answers stay on it, and its 3 open questions stay unanswered.');
  });

  it('names the client site, or says no site: internal work', () => {
    expect(planRelease(base({ kind: 'task', site: SITE })).line).toContain('The work will be on stronghold.example.');
    expect(planRelease(base({ kind: 'task' })).line).toContain('No site: internal work.');
    expect(planRelease(base({ kind: 'project_setup', project: P('queue'), site: SITE })).line).toContain('The work will be on stronghold.example.');
  });

  it('hold on: a card that ends with Bast is tagged needs-pm-release and the line says it waits for the office manager, never promising immediate work', () => {
    const setup = planRelease(base({ kind: 'project_setup', project: P('queue'), pm_hold: true }));
    expect(setup.effects?.add_tags).toEqual(['kickoff', 'from-triage', PM_RELEASE_TAG]);
    expect(setup.line).toContain('tagged kickoff, from-triage and needs-pm-release.');
    expect(setup.line).toContain('It waits for the office manager to pick it up.');
    expect(setup.line).not.toContain('refines the plan');
    for (const kind of ['task', 'project_addition', 'reusable_tool', 'rule_proposal'] as const) {
      const none = planRelease(base({ kind, pm_hold: true }));
      expect(none.effects?.add_tags).toEqual(['from-triage', PM_RELEASE_TAG]);
      expect(none.line).toContain('tagged from-triage and needs-pm-release.');
      expect(none.line).toContain('It waits for the office manager to pick it up.');
      expect(planRelease(base({ kind, assignee_id: BAST, pm_hold: true })).effects?.add_tags).toContain(PM_RELEASE_TAG);
      // a card that ends with a person, or is closed, is not the worker's: no tag, no sentence
      const owned = planRelease(base({ kind, assignee_id: 'u1', assignee_name: 'Sabeen', pm_hold: true }));
      expect(owned.effects?.add_tags).toEqual(['from-triage']);
      expect(owned.line).not.toContain('office manager');
    }
    const closed = planRelease(base({ kind: 'question_only', pm_hold: true }));
    expect(closed.effects?.add_tags).toEqual([]);
  });

  it('hold off: no tag, no waiting sentence, the setup line keeps its old promise', () => {
    const setup = planRelease(base({ kind: 'project_setup', project: P('queue'), pm_hold: false }));
    expect(setup.effects?.add_tags).toEqual(['kickoff', 'from-triage']);
    expect(setup.line).toContain('who refines the plan and creates every task');
    expect(setup.line).not.toContain('office manager');
    expect(planRelease(base({ kind: 'task', pm_hold: false })).effects?.add_tags).toEqual(['from-triage']);
  });

  it('the one switch: on by default, off with TRIAGE_PM_RELEASE_HOLD=off', () => {
    const saved = process.env.TRIAGE_PM_RELEASE_HOLD;
    try {
      delete process.env.TRIAGE_PM_RELEASE_HOLD;
      expect(pmReleaseHold()).toBe(true);
      process.env.TRIAGE_PM_RELEASE_HOLD = 'off';
      expect(pmReleaseHold()).toBe(false);
      process.env.TRIAGE_PM_RELEASE_HOLD = 'on';
      expect(pmReleaseHold()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.TRIAGE_PM_RELEASE_HOLD;
      else process.env.TRIAGE_PM_RELEASE_HOLD = saved;
    }
  });
});
