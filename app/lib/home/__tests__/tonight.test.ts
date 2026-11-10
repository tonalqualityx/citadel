import { describe, it, expect } from 'vitest';
import { assembleHomeResponse, proposeDay } from '../today';
import { selectHome } from '../select';
import { IDS, tonight } from './fixtures/tonight';
import { arcGroupKey, crisisKey, taskKey, threadKey } from '../item-key';
import type { HomeResponse, RawItemState } from '../types';
import { makeState } from './fixtures/tonight';

function run(states: RawItemState[] = []) {
  const { raw, now } = tonight();
  const sel = selectHome({ raw, states, now });
  const day = proposeDay(sel, raw.calendar_events, now);
  const response = assembleHomeResponse({ sel, day, calendar: raw.calendar_events, now, timezone: 'America/New_York', user_id: raw.user_id });
  return { raw, sel, day, response, now };
}

function keys(items: { key: string }[]): string[] {
  return items.map((i) => i.key);
}

describe('tonight fixture: the first screen', () => {
  const { response, day } = run();

  it('Needs you now holds the sign-in, the Grok task and the jillscafe mail, not collectiveyouth', () => {
    const k = keys(response.sections.needs_you_now);
    expect(k).toContain(taskKey(IDS.tSignIn));
    expect(k).toContain(taskKey(IDS.tGrokSecurity));
    expect(k).toContain(crisisKey(IDS.crisisJills));
    expect(k).not.toContain(crisisKey(IDS.crisisYouth));
    expect(k).toHaveLength(3);
    const everywhere = JSON.stringify(response);
    expect(everywhere).not.toContain(IDS.crisisYouth);
    expect(everywhere).not.toContain('collectiveyouth');
  });

  it("Today's group is the Grok arc", () => {
    expect(response.today?.group_key).toBe(arcGroupKey(IDS.grokArc));
    expect(response.today?.arc_id).toBe(IDS.grokArc);
    expect(response.today?.arc_name).toBe("Grok of the Rock: Gene's asks");
    expect(day?.group_key).toBe(arcGroupKey(IDS.grokArc));
  });

  it('Quick has at most 3 rows with the sign-in first', () => {
    const q = response.today!.quick;
    expect(q.length).toBeLessThanOrEqual(3);
    expect(q[0].key).toBe(taskKey(IDS.tSignIn));
    expect(keys(q)).toContain(crisisKey(IDS.crisisJills));
    // The third slot goes to the person who has waited longest among the short rows with a draft.
    expect(q[2].key).toBe(threadKey('mike@becomeindelible.com', 'thr-andy'));
  });

  it('steps are the arc: at most 4, Grok security check first', () => {
    const s = response.today!.steps;
    expect(s.length).toBeLessThanOrEqual(4);
    expect(s).toHaveLength(4);
    expect(s[0].key).toBe(taskKey(IDS.tGrokSecurity));
    expect(response.today!.added_keys).toEqual([]);
  });

  it('Next has 3 visible rows', () => {
    expect(response.sections.next).toHaveLength(3);
    expect(response.sections.next[0].actions[0].filled).toBe(true);
    expect(response.sections.next[1].actions.some((a) => a.filled)).toBe(false);
  });

  it('leads, mail and Everything else follow the rules', () => {
    expect(keys(response.sections.leads)).toEqual([threadKey('mike@becomeindelible.com', 'thr-jessica')]);
    expect(keys(response.sections.mail)).toEqual([threadKey('mike@becomeindelible.com', 'thr-andy')]);
    const groups = Object.fromEntries(response.everything_else.groups.map((g) => [g.key, g.count]));
    expect(groups.older_threads).toBe(1);
    expect(groups.held_projects).toBe(213);
    expect(groups.review_pieces).toBe(39);
    expect(groups.ventures).toBe(1);
    expect(response.everything_else.count).toBe(response.everything_else.groups.reduce((n, g) => n + g.count, 0));
  });

  it('the date-only due date reads Saturday, November 14 and dashes are gone', () => {
    const signIn = response.sections.needs_you_now.find((i) => i.key === taskKey(IDS.tSignIn))!;
    expect(signIn.hard_date).toBe('Due Saturday, November 14');
    const grok = response.sections.needs_you_now.find((i) => i.key === taskKey(IDS.tGrokSecurity))!;
    expect(grok.title).toBe("Grok of the Rock, a hidden link to ki-system.org sits in the live site's footer");
    expect(signIn.opened.summary).not.toMatch(/[–—]/);
  });

  it('no row text matches priority, P1 to P5 or overdue, and no dash appears anywhere', () => {
    const text = JSON.stringify(response);
    expect(text).not.toMatch(/priority|P[1-5]\b|overdue/i);
    expect(text).not.toMatch(/[–—]/);
  });

  it('only real hard dates produce a chip', () => {
    const chips: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'hard_date' && typeof x === 'string') chips.push(x);
          else walk(x);
        }
      }
    };
    walk(response);
    expect(new Set(chips)).toEqual(new Set(['Due Saturday, November 14']));
  });

  it('carries no score, class or rule fields', () => {
    const text = JSON.stringify(response);
    expect(text).not.toMatch(/"(importance|urgency|klass|score|class|quadrant|rule)"/);
  });
});

describe('tonight fixture: his corrections', () => {
  it('"Not an emergency" on the Grok task moves it out of Needs you now', () => {
    const { response, sel } = run([makeState(taskKey(IDS.tGrokSecurity), { not_emergency_at: new Date('2026-11-09T23:00:00Z') })]);
    expect(keys(response.sections.needs_you_now)).not.toContain(taskKey(IDS.tGrokSecurity));
    const grok = sel.byKey.get(taskKey(IDS.tGrokSecurity))!;
    expect(grok.rule).toBeNull();
    expect(grok.item.type).toBe('task');
    expect(grok.item.actions.map((a) => a.id)).toContain('not_now');
    expect(grok.item.actions.map((a) => a.id)).not.toContain('not_emergency');
  });

  it('a pinned item sits alone in things in progress', () => {
    const { response } = run([makeState(taskKey(IDS.tAee), { working_since: new Date('2026-11-09T23:00:00Z') })]);
    expect(keys(response.sections.working_on)).toEqual([taskKey(IDS.tAee)]);
    expect(response.sections.working_on[0].pinned).toBe(true);
    expect(response.sections.working_on[0].actions.map((a) => a.id)).toEqual(['done', 'stop']);
  });
});

export type _Keep = HomeResponse;

describe('tonight fixture: dump for reading by eye', () => {
  it.skipIf(!process.env.DUMP_HOME)('prints the screen', () => {
    const { response } = run();
    const row = (i: { title: string; who: string | null; age: string; why_now: string; effort: string; hard_date: string | null; actions: { label: string; filled: boolean }[]; more_actions: { label: string }[]; reason: string; default_if_ignored: string }) =>
      `  ${i.title}\n    ${i.who ?? ''} | ${i.age} | ${i.why_now} | ${i.effort}${i.hard_date ? ' | ' + i.hard_date : ''}\n    [${i.actions.map((a) => (a.filled ? '*' : '') + a.label).join('] [')}] more: ${i.more_actions.map((a) => a.label).join(', ')}\n    why here: ${i.reason}\n    if nothing: ${i.default_if_ignored}`;
    const out: string[] = [response.screen_date_line];
    const t = response.today;
    if (t) {
      out.push(`TODAY ${t.arc_name} | ${t.size_line} (free ${t.minutes_free}) | why: ${t.why}`);
      out.push(' quick:', ...t.quick.map(row), ' steps:', ...t.steps.map(row));
      out.push(` swap: ${JSON.stringify(t.swap)}`, ` lighter: ${JSON.stringify(t.lighter)}`);
    }
    for (const [k, v] of Object.entries(response.sections)) {
      if (Array.isArray(v)) out.push(`${k.toUpperCase()}`, ...v.map((x) => ('title' in x ? row(x as never) : JSON.stringify(x))));
    }
    out.push(JSON.stringify(response.everything_else, null, 1));
    console.log(out.join('\n'));
  });
});
