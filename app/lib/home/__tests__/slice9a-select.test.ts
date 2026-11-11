import { describe, it, expect } from 'vitest';
import { selectHome } from '../select';
import { proposeDay } from '../today';
import { proposalKey } from '../item-key';
import { homeActSchema } from '../act';
import { actionsFor } from '../actions-for';
import type { RawHomeInputs, RawItemState, RawReconcileCard, RawReconcileLine } from '../types';
import { d, makeInputs, makeState } from './fixtures/tonight';

const NOW = d('2026-11-10T15:00:00Z');
const U = (n: number) => `7aa4a01a-1111-4222-8333-9444455556${String(n).padStart(2, '0')}`;

function sel(raw: Partial<RawHomeInputs>, states: RawItemState[] = []) {
  return selectHome({ raw: makeInputs({ now: NOW, ...raw }), states, now: NOW });
}

function card(n: number, over: Partial<RawReconcileCard> = {}): RawReconcileCard {
  return {
    id: U(n),
    kind: 'done',
    title: `Your email says you removed File Manager ${n}. Mark this done?`,
    lines: ['Your email to Kue Chen, Monday, November 9: "I removed the File Manager plugin."'],
    reason: 'manual',
    link: 'https://mail.google.com/mail/u/?authuser=m#all/t1',
    created_at: new Date(NOW.getTime() - n * 3600_000),
    look_back: false,
    plan: { type: 'done', time: { offer: false, default: 30 } },
    minutes_estimate: null,
    estimate_basis: null,
    who: 'Kue Chen',
    quote_at: d('2026-11-09T15:00:00Z'),
    ...over,
  };
}

describe('Slice 9a: cards from his sent mail on the screen', () => {
  it('one card sits in Decisions ready; the rest wait in "From your sent mail"', () => {
    const r = sel({ reconcile_cards: [card(1), card(2), card(3)] });
    const inNext = r.sections.next.filter((i) => i.type === 'proposal');
    expect(inNext).toHaveLength(1);
    const group = r.everything_else.groups.find((g) => g.key === 'from_sent_mail');
    expect(group?.label).toBe('From your sent mail');
    expect(group?.count).toBe(2);
    expect(group?.items.every((i) => i.key !== inNext[0].key)).toBe(true);
  });

  it('the one slot goes to security first, then Track it, then the newest', () => {
    const security = card(1, { reason: 'security' });
    const track = card(2, { kind: 'track', title: 'Sample page. Track it?', plan: { type: 'track', placement: { kind: 'new', project_id: null, project_name: null } } });
    const newest = card(0 + 9, { created_at: new Date(NOW.getTime() - 60_000) });
    expect(sel({ reconcile_cards: [newest, track, security] }).sections.next.find((i) => i.type === 'proposal')?.key).toBe(proposalKey(security.id));
    expect(sel({ reconcile_cards: [newest, track] }).sections.next.find((i) => i.type === 'proposal')?.key).toBe(proposalKey(track.id));
    const older = card(5);
    expect(sel({ reconcile_cards: [older, newest] }).sections.next.find((i) => i.type === 'proposal')?.key).toBe(proposalKey(newest.id));
  });

  it('every look-back card lives only in the drawer', () => {
    const r = sel({ reconcile_cards: [card(1, { look_back: true }), card(2, { look_back: true })] });
    expect(r.sections.next.some((i) => i.type === 'proposal')).toBe(false);
    expect(r.everything_else.groups.find((g) => g.key === 'from_sent_mail')?.count).toBe(2);
  });

  it('a card he brought forward takes a Next slot beside the first', () => {
    const a = card(1);
    const b = card(2, { look_back: true });
    const r = sel({ reconcile_cards: [a, b] }, [makeState(proposalKey(b.id), { boosted_at: NOW })]);
    expect(r.sections.next.filter((i) => i.type === 'proposal').map((i) => i.key).sort()).toEqual([proposalKey(a.id), proposalKey(b.id)].sort());
  });

  it('a parked card (Not now) leaves Next and goes to the parked group', () => {
    const a = card(1);
    const r = sel({ reconcile_cards: [a] }, [makeState(proposalKey(a.id), { view_at: new Date(NOW.getTime() + 86_400_000), view_set_by: 'user', park_count: 1 })]);
    expect(r.sections.next.some((i) => i.type === 'proposal')).toBe(false);
    expect(r.everything_else.groups.find((g) => g.key === 'parked')?.items.some((i) => i.key === proposalKey(a.id))).toBe(true);
  });

  it('a card is never part of Today: with only cards there is no day to propose', () => {
    expect(proposeDay(sel({ reconcile_cards: [card(1), card(2, { kind: 'track' })] }), [], NOW)).toBeNull();
  });

  it('the row: the card lines, the why line, the exact footer, no priority word', () => {
    const r = sel({ reconcile_cards: [card(1, { reason: 'security' })] });
    const item = r.sections.next[0];
    expect(item.type).toBe('proposal');
    expect(item.proposal?.why).toBe('Why Bast asks: it is a security task, so Bast never closes it on its own.');
    expect(item.default_if_ignored).toBe('Stays here. Nothing changes until you tap.');
    expect(item.reason).toBe(item.proposal?.why);
    expect(item.opened.links).toEqual([{ label: 'Open the email', href: 'https://mail.google.com/mail/u/?authuser=m#all/t1' }]);
    expect(item.actions.map((a) => a.label)).toEqual(['Mark it done', 'Not yet', 'No']);
    expect(item.actions.map((a) => a.id)).toEqual(['proposal_yes', 'not_now', 'proposal_no']);
    expect(JSON.stringify(item)).not.toMatch(/priorit|overdue/i);
  });

  it('buttons by kind', () => {
    const labels = (c: RawReconcileCard) => sel({ reconcile_cards: [c] }).sections.next[0].actions.map((a) => a.label);
    expect(labels(card(1, { kind: 'note' }))).toEqual(['Add the note', 'Not yet', 'No']);
    expect(labels(card(2, { kind: 'waiting' }))).toEqual(['Wait on them', 'Not yet', 'No']);
    expect(labels(card(3, { kind: 'wait' }))).toEqual(['Wait on them', 'Not yet', 'No']);
    expect(labels(card(4, { kind: 'session' }))).toEqual(['Clear the question', 'Not yet', 'No']);
  });

  describe('the Track it card and the owner\'s project rule', () => {
    const track = (placement: Record<string, unknown>, extra: Partial<RawReconcileCard> = {}) =>
      card(1, {
        kind: 'track',
        title: 'Sample page for Phil Camp. Track it?',
        plan: { type: 'track', placement },
        minutes_estimate: 90,
        estimate_basis: 'six emails',
        ...extra,
      });
    const row = (c: RawReconcileCard) => sel({ reconcile_cards: [c] }).sections.next[0];

    it('no live project: only "Start a project for it"', () => {
      const item = row(track({ kind: 'new', project_id: null, project_name: null }));
      expect(item.actions.map((a) => a.label)).toEqual(['Start a project for it', 'Not now', 'No, leave it']);
      expect(item.actions[0]).toMatchObject({ id: 'track_it', placement: 'new_project' });
      expect(item.actions[0].filled).toBe(true);
    });

    it('one live project that clearly fits: "Add to {name}" first, "Start a new project" second', () => {
      const item = row(track({ kind: 'add', project_id: U(50), project_name: 'Phil Camp memorial page' }));
      expect(item.actions.map((a) => a.label)).toEqual(['Add to Phil Camp memorial page', 'Start a new project', 'Not now', 'No, leave it']);
      expect(item.actions.map((a) => a.placement)).toEqual(['project', 'new_project', undefined, undefined]);
      expect(item.actions[0].filled).toBe(true);
    });

    it('an unclear fit asks, with both buttons and no default', () => {
      const item = row(track({ kind: 'ask', project_id: U(50), project_name: 'Annual report' }));
      expect(item.actions.map((a) => a.label)).toEqual(['Add to Annual report', 'Start a new project', 'Not now', 'No, leave it']);
      expect(item.actions.every((a) => !a.filled)).toBe(true);
    });

    it('a single finished one-off is the only loose case: "Track it", no project choice', () => {
      const item = row(track({ kind: 'loose', project_id: null, project_name: null }));
      expect(item.actions.map((a) => a.label)).toEqual(['Track it', 'Not now', 'No, leave it']);
      expect(item.actions[0]).toMatchObject({ id: 'track_it', placement: 'none' });
    });

    it('the time choices are on Track it (the estimate preselected) and on a done card that offers time; never on a note', () => {
      expect(row(track({ kind: 'new', project_id: null, project_name: null })).proposal?.time).toMatchObject({ default: 90, choices: [15, 30, 60, 90, 120], billable_choice: true });
      expect(row(card(2, { plan: { type: 'done', time: { offer: true, default: 45 } } })).proposal?.time).toMatchObject({ default: 45, billable_choice: false });
      expect(row(card(3, { kind: 'note' })).proposal?.time).toBeNull();
      expect(row(card(4)).proposal?.time).toBeNull();
    });

    it('its footer says two weeks and that nothing is made until he taps', () => {
      expect(row(track({ kind: 'new', project_id: null, project_name: null })).default_if_ignored).toBe('Stays here for two weeks, then goes quietly. Nothing is made until you tap.');
    });
  });

  describe('Handled for you: sent-mail lines', () => {
    const line = (over: Partial<RawReconcileLine> = {}): RawReconcileLine => ({
      id: U(80),
      text: 'Noted on "Griswold: clean up the hacked site" from your email to Kue Chen, November 9.',
      details: ['Your email to Kue Chen, Monday, November 9: "I removed the File Manager plugin."'],
      link: 'https://mail.google.com/x',
      at: new Date(NOW.getTime() - 3600_000),
      undo_until: new Date(NOW.getTime() + 3600_000),
      note: true,
      time_prompt: null,
      ...over,
    });
    it('a note line carries Undo and "This was wrong" while the 72 hours are open, with its quote and link', () => {
      const l = sel({ reconcile_lines: [line()] }).sections.handled[0];
      expect(l).toMatchObject({ id: U(80), undo_action_id: U(80), wrong_action_id: U(80), href: 'https://mail.google.com/x', time_prompt: null });
      expect(l.details).toHaveLength(1);
    });
    it('after the window there is neither', () => {
      const l = sel({ reconcile_lines: [line({ undo_until: new Date(NOW.getTime() - 1000) })] }).sections.handled[0];
      expect(l.undo_action_id).toBeNull();
      expect(l.wrong_action_id).toBeNull();
    });
    it('a done-from-a-card line carries "Log time?" and no "This was wrong"', () => {
      const l = sel({ reconcile_lines: [line({ note: false, text: 'Marked "x" done from your email card.', details: [], link: null, time_prompt: { task_id: U(81), minutes: 30, day: '2026-11-09' } })] }).sections.handled[0];
      expect(l.time_prompt).toEqual({ task_id: U(81), minutes: 30, day: '2026-11-09' });
      expect(l.wrong_action_id).toBeNull();
    });
  });
});

describe('Slice 9a: the invariants', () => {
  it('homeActSchema refuses track_it and log_time (a time entry is only ever his tap through POST /api/home/reconcile)', () => {
    expect(homeActSchema.safeParse({ action: 'track_it', item_key: proposalKey(U(1)), placement: 'none', minutes: 30, billable: true }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'log_time', task_id: U(1), minutes: 30, day: '2026-11-10' }).success).toBe(false);
  });
  it('homeActSchema takes proposal_yes and proposal_no on a proposal key only, and is strict', () => {
    expect(homeActSchema.safeParse({ action: 'proposal_yes', item_key: proposalKey(U(1)) }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'proposal_no', item_key: proposalKey(U(1)) }).success).toBe(true);
    expect(homeActSchema.safeParse({ action: 'proposal_yes', item_key: proposalKey(U(1)), minutes: 30 }).success).toBe(false);
    expect(homeActSchema.safeParse({ action: 'proposal_yes', item_key: 'nope' }).success).toBe(false);
  });
  it('actionsFor gives a proposal exactly the buttons it carries, no More list', () => {
    const buttons = [{ id: 'proposal_yes' as const, label: 'Mark it done', filled: false, href: null }];
    expect(actionsFor({ kind: 'proposal', emergency: false, pinned: false, parkCount: 0, filledFirst: true, proposal: { buttons, noDefault: false } })).toEqual({
      actions: [{ ...buttons[0], filled: true }],
      more_actions: [],
    });
    expect(actionsFor({ kind: 'proposal', emergency: false, pinned: false, parkCount: 0, filledFirst: true, proposal: { buttons, noDefault: true } }).actions[0].filled).toBe(false);
  });
});
