import { describe, it, expect } from 'vitest';
import { selectHome, type Candidate } from '../select';
import { stepKey, taskKey } from '../item-key';
import { siteItemKey } from '../emergency/site';
import { evidenceKeys } from '../learn/evidence';
import { STEP_URGENCY_CAP } from '../score';
import type { RawHomeInputs, RawItemState, RawProjectStep, RawSiteIncident, RawWeight } from '../types';
import { IDS, NOW, d, makeAsk, makeClient, makeInputs, makeProject, makeState, makeTask, makeThread, nextId, tonight } from './fixtures/tonight';

const W = (evidence_key: string, weight_pct: number, label = 'Some work'): RawWeight => ({ evidence_key, weight_pct, label });

function run(raw: RawHomeInputs, states: RawItemState[], weights?: RawWeight[]) {
  return selectHome({ raw: weights === undefined ? raw : { ...raw, weights }, states, now: raw.now });
}

/** Every evidence key the candidates of a run can carry, set to `pct`. */
function weightsForAll(raw: RawHomeInputs, pct: number): RawWeight[] {
  const keys = new Set<string>();
  for (const k of ['review', 'session', 'wait', 'thread', 'task', 'step'] as const) keys.add(`type:${k}`);
  const base = selectHome({ raw, states: [], now: raw.now });
  for (const c of base.candidates) {
    const rt = raw.tasks.find((t) => taskKey(t.id) === c.key);
    for (const k of evidenceKeys({ kind: c.kind, client_id: c.item.client?.id, project_id: c.item.project?.id, sop_id: rt?.sop?.id })) keys.add(k);
  }
  return Array.from(keys).map((k) => W(k, pct));
}

function richRaw(): { raw: RawHomeInputs; states: RawItemState[] } {
  const t = tonight();
  const bot = makeTask({ title: 'Bast stopped here', bot_task: true, client: makeClient('Bot Client'), tags: ['needs-mike'] });
  const projectX = makeProject('Alpha site');
  const step: RawProjectStep = {
    project_id: projectX.id,
    project_name: 'Alpha site',
    client: makeClient('Alpha Co'),
    text: 'Mike, send Alpha the proof.',
    source: 'bast',
    step_at: d('2026-11-09T12:00:00Z'),
    last_activity_at: d('2026-09-01T12:00:00Z'),
  };
  const lead = makeThread({ intent: 'sales', from_email: 'lead@new.example', received_at: d('2026-11-03T15:00:00Z') });
  const raw: RawHomeInputs = { ...t.raw, tasks: [...t.raw.tasks, bot], project_steps: [step], threads: [...t.raw.threads, lead] };
  return { raw, states: t.states };
}

const byKey = (cs: Candidate[]) => new Map(cs.map((c) => [c.key, c]));

describe('Slice 7b: with every weight at 100 nothing changes', () => {
  it('selectHome output is deep-equal to a run with no weights loaded (rich fixture, all kinds)', () => {
    const { raw, states } = richRaw();
    const none = run(raw, states);
    const empty = run(raw, states, []);
    const all100 = run(raw, states, weightsForAll(raw, 100));
    expect(empty.sections).toEqual(none.sections);
    expect(all100.sections).toEqual(none.sections);
    expect(all100.everything_else).toEqual(none.everything_else);
    expect(all100.candidates.map((c) => [c.key, c.score, c.section, c.restGroup])).toEqual(
      none.candidates.map((c) => [c.key, c.score, c.section, c.restGroup]),
    );
    expect(all100.candidates.some((c) => c.learned)).toBe(false);
  });
});

describe('Slice 7b: what a weight may and may not move', () => {
  for (const pct of [120, 80]) {
    describe(`every weight at ${pct}`, () => {
      const { raw, states } = richRaw();
      const base = run(raw, states);
      const weighted = run(raw, states, weightsForAll(raw, pct));
      const b = byKey(base.candidates);
      const w = byKey(weighted.candidates);

      it('the weights really did move something (the other checks are not vacuous)', () => {
        expect([...w.values()].filter((c) => c.score.urgency !== b.get(c.key)!.score.urgency).length).toBeGreaterThan(0);
      });

      it('klass, importance and every hard date and its chip are untouched', () => {
        expect(w.size).toBe(b.size);
        for (const [key, c] of w) {
          const o = b.get(key)!;
          expect(c.score.klass).toBe(o.score.klass);
          expect(c.score.importance).toBe(o.score.importance);
          expect(c.score.hardDate).toEqual(o.score.hardDate);
          expect(c.score.hardKind).toBe(o.score.hardKind);
          expect(c.hardDate).toEqual(o.hardDate);
          expect(c.item.hard_date).toBe(o.item.hard_date);
        }
      });

      it('no urgency moves more than 20 percent either way', () => {
        for (const [key, c] of w) {
          const u = b.get(key)!.score.urgency;
          expect(c.score.urgency).toBeGreaterThanOrEqual(Math.round(u * 0.8));
          expect(c.score.urgency).toBeLessThanOrEqual(Math.round(u * 1.2));
        }
      });

      it('emergencies stay where they were, in the same order; the People order and the Needs order do not move', () => {
        expect(weighted.sections.needs_you_now.map((i) => i.key)).toEqual(base.sections.needs_you_now.map((i) => i.key));
        expect(weighted.sections.leads.map((i) => i.key)).toEqual(base.sections.leads.map((i) => i.key));
        expect(weighted.sections.mail.map((i) => i.key)).toEqual(base.sections.mail.map((i) => i.key));
        for (const key of base.sections.needs_you_now.map((i) => i.key)) expect(w.get(key)!.score).toEqual(b.get(key)!.score);
      });

      it('an item with an emergency rule, a crisis mail, a site row, the hands row and a bot task get no weight', () => {
        for (const [key, c] of w) {
          const o = b.get(key)!;
          if (o.rule !== null || o.kind === 'crisis' || o.kind === 'site' || o.kind === 'hands' || o.botTask) {
            expect(c.score).toEqual(o.score);
            expect(c.learned).toBeUndefined();
          }
        }
        expect([...w.values()].some((c) => c.botTask)).toBe(true);
        expect([...w.values()].some((c) => c.kind === 'crisis')).toBe(true);
        expect([...w.values()].some((c) => c.rule !== null)).toBe(true);
      });

      it('no HomeItem field carries a number from a weight (only the footer sentence differs)', () => {
        for (const [key, c] of w) {
          const o = b.get(key)!;
          const { reason: r1, ...rest1 } = c.item;
          const { reason: r2, ...rest2 } = o.item;
          expect(rest1).toEqual(rest2);
          if (!c.learned) expect(r1).toBe(r2);
        }
        const json = JSON.stringify(weighted.sections) + JSON.stringify(weighted.everything_else);
        expect(json).not.toMatch(/weight|multiplier|weight_pct|"urgency"|evidence_key/i);
      });
    });
  }

  it('a lead, a security-family task and a hard-dated task can be raised, never lowered', () => {
    const client = makeClient('Weighted Co');
    const old = d('2026-10-20T15:00:00Z');
    const lead = makeThread({ intent: 'sales', client, from_email: 'lead@new.example', received_at: old });
    const sec = makeTask({ tags: ['security-report'], client, clock_started_at: old, created_at: old });
    const life = makeTask({ tags: ['job-watch:foo'], client, clock_started_at: old, created_at: old });
    const hard = makeTask({ client, due_date: d('2026-11-30T00:00:00.000Z'), promised_to: 'Gene', clock_started_at: old, created_at: old });
    const plain = makeTask({ client, requested_by_contact_id: 'c', clock_started_at: old, created_at: old });
    const raw = makeInputs({ now: NOW, tasks: [sec, life, hard, plain], threads: [lead] });
    const base = run(raw, []);
    const down = run(raw, [], [W(`client:${client.id}`, 80, 'Weighted Co')]);
    const up = run(raw, [], [W(`client:${client.id}`, 120, 'Weighted Co')]);
    const keyOf = [taskKey(sec.id), taskKey(life.id), taskKey(hard.id), 'thread:' + lead.account + ':' + lead.thread_id];
    for (const k of keyOf) {
      const o = base.byKey.get(k);
      expect(o, k).toBeDefined();
      expect(down.byKey.get(k)!.score.urgency).toBe(o!.score.urgency);
      expect(up.byKey.get(k)!.score.urgency).toBeGreaterThanOrEqual(o!.score.urgency);
    }
    // The plain task is lowered by the same weight, and raised by the other.
    expect(down.byKey.get(taskKey(plain.id))!.score.urgency).toBeLessThan(base.byKey.get(taskKey(plain.id))!.score.urgency);
    expect(up.byKey.get(taskKey(plain.id))!.score.urgency).toBeGreaterThan(base.byKey.get(taskKey(plain.id))!.score.urgency);
    // At least one of the protected rows really rose.
    expect(keyOf.some((k) => up.byKey.get(k)!.score.urgency > base.byKey.get(k)!.score.urgency)).toBe(true);
  });

  it('three weights at 120 give a multiplier of 1.20, not 1.73', () => {
    const client = makeClient('Triple Co');
    const project = makeProject('Triple project');
    const sop = { id: nextId(), title: 'Triple SOP' };
    const t = makeTask({ client, project, sop, requested_by_contact_id: 'c', clock_started_at: d('2026-10-20T15:00:00Z') }); // class 1, urgency 80
    const raw = makeInputs({ now: NOW, tasks: [t] });
    const r = run(raw, [], [W(`client:${client.id}`, 120), W(`project:${project.id}`, 120), W(`sop:${sop.id}`, 120)]);
    const base = run(raw, []).byKey.get(taskKey(t.id))!.score.urgency;
    expect(r.byKey.get(taskKey(t.id))!.score.urgency).toBe(Math.round(base * 1.2));
  });

  it('inside a class a weight breaks a tie: the newer task comes first once it is raised; the class does not change', () => {
    const x = makeClient('X Co');
    const y = makeClient('Y Co');
    const a = makeTask({ title: 'A older', client: y, requested_by_contact_id: 'c', clock_started_at: d('2026-11-04T14:00:00Z') });
    const b = makeTask({ title: 'B newer', client: x, requested_by_contact_id: 'c', clock_started_at: d('2026-11-04T18:00:00Z') });
    const raw = makeInputs({ now: NOW, tasks: [a, b] });
    expect(run(raw, []).sections.next.map((i) => i.title)).toEqual(['A older', 'B newer']);
    const r = run(raw, [], [W(`client:${x.id}`, 105, 'X Co')]);
    expect(r.sections.next.map((i) => i.title)).toEqual(['B newer', 'A older']);
    expect(r.byKey.get(taskKey(b.id))!.score.klass).toBe(run(raw, []).byKey.get(taskKey(b.id))!.score.klass);
    expect(r.sections.next[0].reason).toContain('Comes up a little sooner because you moved X Co work up before.');
    expect(r.sections.next[1].reason).not.toContain('Comes up');
  });

  it('a lowered weight can take a task at the Next entry edge out of Next', () => {
    const x = makeClient('Edge Co');
    const t = makeTask({ title: 'Edge', client: x, requested_by_contact_id: 'c', clock_started_at: d('2026-11-06T14:00:00Z') }); // class 1, urgency 30
    const raw = makeInputs({ now: NOW, tasks: [t] });
    expect(run(raw, []).sections.next.map((i) => i.title)).toEqual(['Edge']);
    const r = run(raw, [], [W(`client:${x.id}`, 95, 'Edge Co')]);
    expect(r.sections.next).toEqual([]);
    expect(r.everything_else.groups.find((g) => g.key === 'waiting_turn')?.count).toBe(1);
  });

  it('a project step is never raised above its cap, and still only one unboosted step holds a Next slot', () => {
    const mk = (name: string, quiet: string): RawProjectStep => ({
      project_id: nextId(),
      project_name: name,
      client: makeClient(`${name} Co`),
      text: `Mike, do ${name}.`,
      source: 'bast',
      step_at: d('2026-11-09T12:00:00Z'),
      last_activity_at: d(quiet),
    });
    const steps = [mk('One', '2026-08-01T12:00:00Z'), mk('Two', '2026-08-02T12:00:00Z'), mk('Three', '2026-08-03T12:00:00Z')];
    const raw = makeInputs({ now: NOW, project_steps: steps });
    const base = run(raw, []);
    const weighted = run(raw, [], [W('type:step', 120, 'project next steps')]);
    const stepsIn = (r: ReturnType<typeof run>) => r.sections.next.filter((i) => i.type === 'step');
    expect(stepsIn(base)).toHaveLength(1);
    expect(stepsIn(weighted)).toHaveLength(1);
    for (const c of weighted.candidates.filter((c) => c.kind === 'step')) expect(c.score.urgency).toBeLessThanOrEqual(STEP_URGENCY_CAP);
    const low = run(raw, [], [W('type:step', 80, 'project next steps')]);
    expect(stepsIn(low).length).toBeLessThanOrEqual(1);
    expect(stepKey(steps[0].project_id)).toBeTruthy();
  });

  it('a bot task gets no weight and the one-slot rule for bot tasks holds', () => {
    const client = makeClient('Bot Co');
    const bots = [0, 1].map((i) => makeTask({ title: `Bot ${i}`, bot_task: true, client, tags: ['needs-mike'], clock_started_at: new Date(NOW.getTime() - (i + 1) * 86_400_000) }));
    const raw = makeInputs({ now: NOW, tasks: bots });
    const base = run(raw, []);
    const weighted = run(raw, [], [W(`client:${client.id}`, 120), W('type:task', 120)]);
    expect(weighted.sections.next.filter((i) => bots.some((b) => taskKey(b.id) === i.key))).toHaveLength(1);
    expect(weighted.candidates.map((c) => c.score)).toEqual(base.candidates.map((c) => c.score));
  });

  it('a site-down row and a crisis mail get no weight', () => {
    const client = makeClient("Jill's");
    const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const inc: RawSiteIncident = {
      site_id: SITE,
      domain: 'jills.example',
      client_id: client.id,
      client_name: client.name,
      source: 'kuma',
      ask_ids: [],
      started_at: new Date(NOW.getTime() - 40 * 60_000),
      last_checked_at: new Date(NOW.getTime() - 60_000),
      last_check_up: null,
      closed_at: null,
      close_reason: null,
      mail_links: [],
    };
    const crisis = makeAsk({ is_urgent: true, client, from_email: 'boss@jills.example', subject: 'Down' });
    const raw = makeInputs({ now: NOW, site_incidents: [inc], crises: [crisis] });
    const weights = [W(`client:${client.id}`, 120), W('type:task', 120), W('type:thread', 120)];
    const base = run(raw, []);
    const r = run(raw, [], weights);
    expect(r.byKey.get(siteItemKey(SITE))).toBeDefined();
    expect(r.candidates.map((c) => c.score)).toEqual(base.candidates.map((c) => c.score));
    expect(r.sections.needs_you_now.map((i) => i.key)).toEqual(base.sections.needs_you_now.map((i) => i.key));
  });

  it('an emergency on a weighted client is still first in Needs you now', () => {
    const client = makeClient('Hot Co');
    const sec = makeTask({ tags: ['security'], client, site_id: 's', created_at: d('2026-11-09T10:00:00Z'), clock_started_at: d('2026-11-09T10:00:00Z') });
    const other = clientTaskFor(client);
    const raw = makeInputs({ now: NOW, tasks: [other, sec] });
    const r = run(raw, [], [W(`client:${client.id}`, 120)]);
    expect(r.sections.needs_you_now[0].key).toBe(taskKey(sec.id));
    expect(r.byKey.get(taskKey(sec.id))!.score).toEqual(run(raw, []).byKey.get(taskKey(sec.id))!.score);
  });

  it('a boost and a park read the same with weights (state is not touched)', () => {
    const client = makeClient('S Co');
    const t = clientTaskFor(client);
    const states = [makeState(taskKey(t.id), { boosted_at: NOW })];
    const raw = makeInputs({ now: NOW, tasks: [t] });
    const r = run(raw, states, [W(`client:${client.id}`, 120)]);
    expect(r.sections.next.map((i) => i.key)).toEqual([taskKey(t.id)]);
    expect(r.byKey.get(taskKey(t.id))!.boosted).toBe(true);
    void IDS;
  });
});

function clientTaskFor(client: ReturnType<typeof makeClient>) {
  return makeTask({ client, requested_by_contact_id: 'c', clock_started_at: d('2026-11-02T14:00:00Z') });
}
