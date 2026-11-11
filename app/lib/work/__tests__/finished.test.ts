// @vitest-environment node
/** Work stage G: the evidence engine, case by case (fixtures/finished-cases.json), plus the plain-words rules. */
import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/finished-cases.json';
import { BATCH_GROUPS, ONE_TAP_GROUPS, eligibility, hasUntickedItem, judge, tickedByDefault, titleOverlap, type Signals, type TaskFacts } from '../finished';
import { FINISHED_CARD, FINISHED_MESSAGES, closeComment, closedLine, closedOneLine, skippedLine } from '../finished-copy';
import { FINISHED_CARD_KEY, parseItemKey, buildItemKey } from '@/lib/home/item-key';
import { homeActSchema } from '@/lib/home/act';

const NOW = new Date(fixtures.now);
const d = (v: string | null | undefined) => (v ? new Date(v) : null);
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function task(t: J): TaskFacts {
  return { ...t, created_at: new Date(t.created_at), updated_at: new Date(t.updated_at) } as TaskFacts;
}
function signals(s: J): Signals {
  return {
    receipts: s.receipts.map((r: J) => ({ ...r, created_at: new Date(r.created_at) })),
    machine: s.machine.map((m: J) => ({ ...m, at: new Date(m.at) })),
    reconcile: s.reconcile.map((r: J) => ({ ...r, quote_at: d(r.quote_at) })),
    calendar: s.calendar.map((c: J) => ({ ...c, ends_at: new Date(c.ends_at) })),
    contact_emails: s.contact_emails,
    contact_names: s.contact_names,
    asks: s.asks.map((a: J) => ({ ...a, received_at: new Date(a.received_at) })),
    outbox_sent: s.outbox_sent.map((x: string) => new Date(x)),
    later_done: s.later_done.map((x: J) => ({ ...x, completed_at: new Date(x.completed_at) })),
  };
}

describe('finished evidence cases', () => {
  it('has at least 30 cases', () => expect(fixtures.cases.length).toBeGreaterThanOrEqual(30));
  for (const c of fixtures.cases as J[]) {
    it(c.name, () => {
      if (c.eligibility) {
        expect(eligibility(task(c.task), 'owner', ['bot'], NOW)).toBe(c.eligibility);
        return;
      }
      const v = judge(task(c.task), signals(c.signals), NOW, 'America/New_York');
      if (c.expect === null) {
        expect(v).toBeNull();
        return;
      }
      expect(v).not.toBeNull();
      expect(v?.group).toBe(c.expect.group);
      expect(v?.strength).toBe(c.expect.strength);
      expect(v?.evidence.map((e) => e.kind)).toEqual(c.expect.kinds);
    });
  }
});

describe('evidence lines read in plain words', () => {
  it('names where the proof came from and has no dash or banned word', () => {
    const lines: string[] = [];
    for (const c of fixtures.cases as J[]) {
      if (c.eligibility) continue;
      const v = judge(task(c.task), signals(c.signals), NOW, 'America/New_York');
      for (const e of v?.evidence ?? []) lines.push(e.line);
    }
    expect(lines.length).toBeGreaterThan(15);
    for (const l of lines) {
      expect(l).not.toMatch(/[–—]/);
      expect(l).not.toMatch(/priorit|overdue/i);
    }
    expect(lines.some((l) => /^Live on lifelineiv\.com since Nov 3 \(go-live receipt\)$/.test(l))).toBe(true);
    expect(lines.some((l) => /^Its project "Phil Camp memorial page" is done$/.test(l))).toBe(true);
    expect(lines.some((l) => /^Bast finished it on Nov \d+ \(worker run\), still marked in progress$/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith('Your email to Kue on Nov 9: "I removed the File Manager plugin."'))).toBe(true);
    expect(lines.some((l) => /^The call with Morgan happened on Nov 10 \(calendar\)$/.test(l))).toBe(true);
  });
});

describe('small rules', () => {
  it('ticked by default: strong main and every orphan, never medium main or the one-tap groups', () => {
    expect(tickedByDefault('main', 'strong')).toBe(true);
    expect(tickedByDefault('main', 'medium')).toBe(false);
    expect(tickedByDefault('orphan', 'medium')).toBe(true);
    for (const g of ['security', 'portal', 'unticked']) expect(tickedByDefault(g, 'strong')).toBe(false);
  });
  it('batches take main and orphan only; one tap takes security and portal only; unticked is in neither', () => {
    expect(BATCH_GROUPS).toEqual(['main', 'orphan']);
    expect(ONE_TAP_GROUPS).toEqual(['security', 'portal']);
  });
  it('title overlap and checklist reading', () => {
    expect(titleOverlap('Add the blurb', 'Add the blurb to the home page')).toBeGreaterThanOrEqual(0.5);
    expect(titleOverlap('Renew hosting', 'Add the blurb')).toBe(0);
    expect(hasUntickedItem(null, undefined, [])).toBe(false);
    expect(hasUntickedItem([{ id: 'a', text: 'x', completed: true, sort_order: 0 }])).toBe(false);
    expect(hasUntickedItem([{ id: 'a', text: 'x', sort_order: 0 }])).toBe(true);
  });
});

describe('copy and keys', () => {
  it('the card words are plain', () => {
    const all = [
      FINISHED_CARD.title(23),
      FINISHED_CARD.title(1),
      FINISHED_CARD.securityHead(3),
      FINISHED_CARD.portalHead(4),
      FINISHED_CARD.untickedHead(5),
      FINISHED_CARD.orphanHead(61),
      FINISHED_CARD.others(5, "Sabeen"),
      FINISHED_CARD.whyNow,
      FINISHED_CARD.ifIgnored,
      FINISHED_CARD.reason,
      FINISHED_CARD.closeTicked,
      FINISHED_CARD.notFinished,
      ...Object.values(FINISHED_MESSAGES),
      closedLine(23),
      closedLine(1),
      closedOneLine('Add the blurb — now'),
      closeComment('Live on x.test since Nov 2 (go-live receipt)'),
      skippedLine(2),
    ];
    expect(FINISHED_CARD.title(23)).toBe('23 tasks look finished. Close them?');
    expect(closedLine(23)).toBe('Closed 23 tasks that looked finished.');
    expect(closeComment('Live on x.test since Nov 2 (go-live receipt)')).toBe('Closed from the looks-finished list: Live on x.test since Nov 2 (go-live receipt).');
    for (const s of all) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/priorit|overdue/i);
    }
  });
  it('item keys: the card is finished:all and a row is finished:<uuid>', () => {
    expect(FINISHED_CARD_KEY).toBe('finished:all');
    expect(parseItemKey('finished:all')).toEqual({ kind: 'finished', id: null });
    const id = '7aa4a01a-1111-4222-8333-944445555666';
    expect(parseItemKey(`finished:${id}`)).toEqual({ kind: 'finished', id });
    expect(buildItemKey({ kind: 'finished', id })).toBe(`finished:${id}`);
    expect(parseItemKey('finished:nope')).toBeNull();
  });
  it('the act schema takes 1 to 100 keys and nothing else', () => {
    const k = 'finished:7aa4a01a-1111-4222-8333-944445555666';
    expect(homeActSchema.safeParse({ action: 'finished_close', item_keys: [k] }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'finished_close', item_keys: [] }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'finished_close', item_keys: Array(101).fill(k) }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'finished_close', item_keys: [k], user_id: 'x' }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'finished_close_one', item_key: k }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'finished_keep', item_key: k }).success).toBe(true);
  });
});
