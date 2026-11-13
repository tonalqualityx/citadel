import { describe, it, expect } from 'vitest';
import { planRelease, describeRelease, pmReleaseHold, PM_RELEASE_TAG, RELEASE_REFUSALS, TRIAGE_KINDS, type ReleaseInput } from '../triage-kind';

const BAST = 'bast-id';
const P = (status: string) => ({ id: 'p1', name: 'Stronghold', status });
const base = (over: Partial<ReleaseInput>): ReleaseInput => ({ kind: 'task', assignee_id: null, assignee_name: null, project: null, bast_id: BAST, ...over });

const SYSTEM_WORDS = /not_started|not started|kickoff|needs-pm-release|from-triage|held-for|lane|office manager|tagged|assigned to/i;

describe('planRelease: the line and the effects come from one function', () => {
  it('no kind: not ready, the line says Not sorted yet, no effects', () => {
    const r = planRelease(base({ kind: null }));
    expect(r).toMatchObject({ ready: false, block: 'unsorted', line: 'Not sorted yet', effects: null });
  });

  it('project_setup on a queue project: data and the exact sentence, both hold states', () => {
    const on = planRelease(base({ kind: 'project_setup', project: P('queue'), assignee_id: 'someone', pm_hold: true }));
    expect(on.effects).toMatchObject({ to_status: 'not_started', assign_bast: true, add_tags: ['kickoff', 'from-triage', PM_RELEASE_TAG], project_to_ready: true, starts_project: true, held_for_dox: true, lands_on: 'Bast' });
    expect(on.line).toBe('Starts the project: hands Stronghold to Dox to set up, creating and assigning every task. Nothing begins until Dox picks it up.');
    const off = planRelease(base({ kind: 'project_setup', project: P('queue'), pm_hold: false }));
    expect(off.effects).toMatchObject({ add_tags: ['kickoff', 'from-triage'], held_for_dox: false });
    expect(off.line).toBe('Starts the project: hands Stronghold to Dox to set up, creating and assigning every task.');
  });

  it('project_setup on an already live project does not say it starts the project', () => {
    const r = planRelease(base({ kind: 'project_setup', project: P('in_progress'), pm_hold: true }));
    expect(r.effects).toMatchObject({ project_to_ready: false, starts_project: false });
    expect(r.line).not.toContain('Starts the project');
    expect(r.line).toBe('Hands Stronghold to Dox to set up, who creates and assigns every task. Nothing begins until Dox picks it up.');
  });

  it('project_setup is refused for a quote project, no project, and a closed project, and the line says why', () => {
    expect(planRelease(base({ kind: 'project_setup', project: P('quote') }))).toMatchObject({ ready: false, block: 'still_quote', effects: null });
    expect(planRelease(base({ kind: 'project_setup', project: P('quote') })).line).toContain('still a quote');
    expect(planRelease(base({ kind: 'project_setup' }))).toMatchObject({ ready: false, block: 'no_project' });
    for (const s of ['cancelled', 'done', 'suspended']) expect(planRelease(base({ kind: 'project_setup', project: P(s) }))).toMatchObject({ ready: false, block: 'project_closed' });
  });

  it('task, reusable_tool, rule_proposal: the exact sentence on Bast in both hold states, and on a person', () => {
    for (const kind of ['task', 'reusable_tool', 'rule_proposal'] as const) {
      const wording = kind === 'rule_proposal' ? ' Releasing approves the wording on this card.' : '';
      const on = planRelease(base({ kind, pm_hold: true }));
      expect(on.effects).toMatchObject({ to_status: 'not_started', assign_bast: true, add_tags: ['from-triage', PM_RELEASE_TAG], project_to_ready: false, lands_on: 'Bast', held_for_dox: true });
      expect(on.line).toBe(`Hands this to Bast. Nothing begins until Dox picks it up.${wording}`);
      const off = planRelease(base({ kind, pm_hold: false }));
      expect(off.effects).toMatchObject({ assign_bast: true, add_tags: ['from-triage'], held_for_dox: false });
      expect(off.line).toBe(`Hands this to Bast to do.${wording}`);
      const owned = planRelease(base({ kind, assignee_id: 'u1', assignee_name: 'Sabeen', pm_hold: true }));
      expect(owned.effects).toMatchObject({ assign_bast: false, add_tags: ['from-triage'], lands_on: 'Sabeen', lands_on_bast: false, held_for_dox: false });
      expect(owned.line).toBe(`Hands this to Sabeen.${wording}`);
      expect(planRelease(base({ kind, assignee_id: BAST, pm_hold: false })).line).toBe(`Hands this to Bast to do.${wording}`);
    }
  });

  it('project_addition names its project; a quote project refuses every non-setup kind', () => {
    expect(planRelease(base({ kind: 'project_addition', project: P('queue'), pm_hold: true })).line).toBe('Adds this to Stronghold and hands it to Bast. Nothing begins until Dox picks it up.');
    expect(planRelease(base({ kind: 'project_addition', project: P('queue'), pm_hold: false })).line).toBe('Adds this to Stronghold and hands it to Bast to do.');
    expect(planRelease(base({ kind: 'project_addition', project: P('queue'), assignee_id: 'u1', assignee_name: 'Sabeen' })).line).toBe('Adds this to Stronghold and hands it to Sabeen.');
    for (const kind of ['task', 'project_addition', 'reusable_tool', 'rule_proposal'] as const) {
      expect(planRelease(base({ kind, project: P('quote') }))).toMatchObject({ ready: false, block: 'still_quote' });
    }
  });

  it('question_only closes the card and says the questions and answers stay', () => {
    const r = planRelease(base({ kind: 'question_only', assignee_id: 'u1' }));
    expect(r.effects).toMatchObject({ to_status: 'done', assign_bast: false, add_tags: [], project_to_ready: false, closes_card: true, lands_on: null });
    expect(r.line).toBe('Closes this card. The questions and your answers stay on it.');
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

describe('planRelease: questions, site and the worker hold', () => {
  const SITE = { id: 's1', name: 'stronghold.example' };

  it('says how many questions go ahead and how many wait, and that the card stays flagged until answered', () => {
    const r = planRelease(base({ kind: 'task', open_go: 2, open_wait: 1 }));
    expect(r.effects?.questions).toEqual({ go: 2, wait: 1, stay: 0 });
    expect(r.line).toContain('2 open questions go ahead with the recommendation.');
    expect(r.line).toContain('1 open question waits for you; the card stays flagged for you until you answer.');
    expect(planRelease(base({ kind: 'task', open_go: 1 })).line).toContain('1 open question goes ahead with the recommendation.');
    expect(planRelease(base({ kind: 'task' })).line).not.toContain('open question');
    const closed = planRelease(base({ kind: 'question_only', open_go: 1, open_wait: 2 }));
    expect(closed.effects?.questions).toEqual({ go: 0, wait: 0, stay: 3 });
    expect(closed.line).toBe('Closes this card. The questions and your answers stay on it. 3 open questions stay unanswered.');
    expect(planRelease(base({ kind: 'question_only', open_wait: 1 })).line).toContain('1 open question stays unanswered.');
  });

  it('names the client site, and says nothing when there is none', () => {
    expect(planRelease(base({ kind: 'task', site: SITE })).line).toContain('The work is on stronghold.example.');
    expect(planRelease(base({ kind: 'task' })).line).not.toMatch(/site|internal|The work is on/i);
    expect(planRelease(base({ kind: 'project_setup', project: P('queue'), site: SITE })).line).toContain('The work is on stronghold.example.');
    expect(planRelease(base({ kind: 'question_only', site: SITE })).line).not.toContain('The work is on');
  });

  it('the Details lines carry the technical facts the sentence leaves out', () => {
    const r = planRelease(base({ kind: 'project_setup', project: P('queue'), pm_hold: true }));
    expect(r.details).toEqual(['Status: Not started', 'Assigned to Bast', `Tags added: kickoff, from-triage, ${PM_RELEASE_TAG}`, 'Stronghold goes from queue to ready']);
    expect(r.line).not.toMatch(SYSTEM_WORDS);
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

/**
 * The truth guarantee at the pure level: for every combination, each effect that matters to the owner has its phrase in the
 * sentence when it is on, and the phrase is absent when it is off. The integration test then compares the same effects with the database.
 */
describe('planRelease: every effect has its phrase, present exactly when the effect is', () => {
  const SITE = { id: 's1', name: 'stronghold.example' };
  const cases: ReleaseInput[] = [];
  for (const kind of TRIAGE_KINDS)
    for (const assignee of [null, BAST, 'u1'])
      for (const status of ['none', 'queue', 'in_progress'])
        for (const hold of [true, false])
          for (const site of [null, SITE])
            for (const [go, wait] of [[0, 0], [2, 0], [0, 1], [1, 3]])
              cases.push(base({ kind, assignee_id: assignee, assignee_name: assignee === 'u1' ? 'Sabeen' : null, project: status === 'none' ? null : P(status), pm_hold: hold, site, open_go: go, open_wait: wait }));

  it('runs the whole table', () => {
    let ran = 0;
    for (const input of cases) {
      const r = planRelease(input);
      if (!r.ready || !r.effects) continue;
      ran += 1;
      const fx = r.effects;
      const line = r.line;
      const label = JSON.stringify(input);
      const has = (re: RegExp) => re.test(line);
      // the sentence is exactly what describeRelease says of the data, and says no system word
      expect(line, label).toBe(describeRelease(fx));
      expect(line, label).not.toMatch(SYSTEM_WORDS);
      // who it lands on
      if (fx.closes_card) expect(has(/^Closes this card\./), label).toBe(true);
      else if (fx.kind !== 'project_setup') expect(has(new RegExp(`hands (this|it) to ${fx.lands_on}\\b`, 'i')), label).toBe(true);
      expect(has(/Closes this card/), label).toBe(fx.closes_card);
      expect(has(/The questions and your answers stay on it/), label).toBe(fx.closes_card);
      // project made ready / set up by Dox
      expect(has(/^Starts the project:/), label).toBe(fx.project_to_ready);
      expect(has(/to Dox to set up/), label).toBe(fx.kind === 'project_setup');
      // held for Dox
      expect(has(/Nothing begins until Dox picks it up\./), label).toBe(fx.held_for_dox);
      expect(fx.held_for_dox, label).toBe(fx.add_tags.includes(PM_RELEASE_TAG));
      expect(fx.held_for_dox, label).toBe(input.pm_hold === true && fx.lands_on_bast && !fx.closes_card);
      // a card that lands on Bast with no hold promises it is to do
      expect(has(/ to do\./), label).toBe(fx.kind !== 'project_setup' && !fx.closes_card && fx.lands_on_bast && !fx.held_for_dox);
      // the project an addition goes to
      expect(has(/Adds this to /), label).toBe(fx.kind === 'project_addition' && !!input.project);
      // the site
      expect(has(/The work is on /), label).toBe(!fx.closes_card && !!input.site);
      expect(fx.site_name, label).toBe(fx.closes_card ? null : (input.site?.name ?? null));
      // the questions
      expect(has(/questions? go(es)? ahead with the recommendation\./), label).toBe(fx.questions.go > 0);
      expect(has(/waits? for you; the card stays flagged for you until you answer\./), label).toBe(fx.questions.wait > 0);
      expect(has(/stays? unanswered\./), label).toBe(fx.questions.stay > 0);
      // approves the wording
      expect(has(/Releasing approves the wording on this card\./), label).toBe(fx.approves_wording);
      expect(fx.approves_wording, label).toBe(fx.kind === 'rule_proposal');
    }
    expect(ran).toBeGreaterThan(400);
  });
});
