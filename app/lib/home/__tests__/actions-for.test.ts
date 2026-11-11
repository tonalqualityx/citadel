import { describe, it, expect } from 'vitest';
import { actionsFor, asArcStepActions, withoutAddToArc, type ActionsInput } from '../actions-for';

const base: ActionsInput = { kind: 'task', emergency: false, pinned: false, parkCount: 0, filledFirst: false };
const ids = (a: { id: string }[]) => a.map((x) => x.id);

describe('actionsFor', () => {
  it('task: I\'ll do it now, Done, Not now; Open, This matters more, Add to today\'s arc under More', () => {
    const r = actionsFor(base);
    expect(ids(r.actions)).toEqual(['do_now', 'done', 'not_now']);
    expect(ids(r.more_actions)).toEqual(['open_task', 'matters_more', 'add_to_arc']);
    expect(r.actions.map((a) => a.label)).toEqual(["I'll do it now", 'Done', 'Not now']);
  });

  it('an emergency has Not an emergency in place of Not now, and no This matters more', () => {
    const r = actionsFor({ ...base, emergency: true });
    expect(ids(r.actions)).toEqual(['do_now', 'done', 'not_emergency']);
    expect(ids(r.more_actions)).toEqual(['open_task', 'add_to_arc']);
  });

  it('the third Not now is withdrawn: a task gets Let it go, other kinds keep their real choices', () => {
    expect(ids(actionsFor({ ...base, parkCount: 3 }).actions)).toEqual(['do_now', 'done', 'let_it_go']);
    expect(ids(actionsFor({ ...base, parkCount: 2 }).actions)).toEqual(['do_now', 'done', 'not_now']);
    const thread = actionsFor({ ...base, kind: 'thread', parkCount: 3, draftUrl: 'https://x', threadUrl: 'https://y' });
    expect(ids(thread.actions)).toEqual(['open_draft', 'no_reply_needed']);
  });

  it('thread with a draft: Open the draft, No reply needed, Not now; Open the thread under More', () => {
    const r = actionsFor({ ...base, kind: 'thread', draftUrl: 'https://draft', threadUrl: 'https://thread' });
    expect(r.actions.map((a) => [a.id, a.href])).toEqual([
      ['open_draft', 'https://draft'],
      ['no_reply_needed', null],
      ['not_now', null],
    ]);
    expect(r.more_actions[0]).toMatchObject({ id: 'open_thread', href: 'https://thread', label: 'Open the thread' });
  });

  it('thread without a draft opens the thread first', () => {
    const r = actionsFor({ ...base, kind: 'thread', threadUrl: 'https://thread' });
    expect(ids(r.actions)).toEqual(['open_thread', 'no_reply_needed', 'not_now']);
  });

  it('review fold: Approve all {n}, Not now', () => {
    const r = actionsFor({ ...base, kind: 'review', pieceCount: 39 });
    expect(r.actions.map((a) => a.label)).toEqual(['Approve all 39', 'Not now']);
  });

  it('session ask: Open the session with its link, Not now', () => {
    const r = actionsFor({ ...base, kind: 'session', sessionUrl: 'https://claude.ai/code/s' });
    expect(r.actions.map((a) => [a.id, a.href])).toEqual([
      ['open_session', 'https://claude.ai/code/s'],
      ['not_now', null],
    ]);
    expect(ids(actionsFor({ ...base, kind: 'session' }).actions)).toEqual(['not_now']);
  });

  it('wait: Approve with an approval request, Done otherwise, Open only for a price review', () => {
    expect(ids(actionsFor({ ...base, kind: 'wait', waitApprovable: true }).actions)).toEqual(['approve_wait', 'not_now']);
    expect(ids(actionsFor({ ...base, kind: 'wait' }).actions)).toEqual(['complete_wait', 'not_now']);
    const price = actionsFor({ ...base, kind: 'wait', waitPriceReview: true, waitApprovable: true, waitHref: '/charters/1' });
    expect(price.actions.map((a) => [a.id, a.href])).toEqual([
      ['open_wait', '/charters/1'],
      ['not_now', null],
    ]);
    expect(ids(actionsFor({ ...base, kind: 'wait', waitPriceReview: true, hasTaskId: true }).actions)[0]).toBe('open_wait');
    expect(ids(actionsFor({ ...base, kind: 'wait', waitPriceReview: true }).actions)).toEqual(['not_now']);
  });

  it('crisis mail: Handled, Open the thread, Not an emergency', () => {
    const r = actionsFor({ ...base, kind: 'crisis', emergency: true, threadUrl: 'https://thread' });
    expect(ids(r.actions)).toEqual(['handled', 'open_thread', 'not_emergency']);
  });

  it('a pinned item shows its finishing button and Stop for now, never I\'ll do it now or Not now', () => {
    const r = actionsFor({ ...base, pinned: true });
    expect(ids(r.actions)).toEqual(['done', 'stop']);
    expect(ids(r.more_actions)).toEqual(['open_task']);
  });

  it('never more than 3 visible buttons', () => {
    const r = actionsFor({ ...base, kind: 'thread', pinned: true, draftUrl: 'https://d', threadUrl: 'https://t' });
    expect(r.actions.length).toBeLessThanOrEqual(3);
    for (const kind of ['task', 'review', 'session', 'wait', 'thread', 'crisis'] as const) {
      for (const emergency of [false, true]) {
        expect(actionsFor({ ...base, kind, emergency, draftUrl: 'd', threadUrl: 't', sessionUrl: 's' }).actions.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('fills only the first visible button, and only when asked', () => {
    expect(actionsFor({ ...base, filledFirst: true }).actions.map((a) => a.filled)).toEqual([true, false, false]);
    expect(actionsFor(base).actions.some((a) => a.filled)).toBe(false);
  });

  it('Slice 1 offers nothing that needs a later slice', () => {
    const all = (['task', 'review', 'session', 'wait', 'thread', 'crisis'] as const).flatMap((kind) => {
      const r = actionsFor({ ...base, kind, draftUrl: 'd', threadUrl: 't', sessionUrl: 's', pieceCount: 2 });
      return [...r.actions, ...r.more_actions].map((a) => a.label);
    });
    for (const label of all) expect(label).not.toMatch(/send the draft|sabeen|book|calendar link|draft it/i);
  });

  it('asArcStepActions swaps Add for Remove from arc; withoutAddToArc drops Add', () => {
    const more = actionsFor(base).more_actions;
    expect(ids(asArcStepActions(more))).toEqual(['open_task', 'matters_more', 'remove_from_arc']);
    expect(ids(withoutAddToArc(more))).toEqual(['open_task', 'matters_more']);
  });
});

describe('actionsFor: a task Bast stopped on', () => {
  it('Open, Not now, This matters more; no Done, no I\'ll do it now, no arc', () => {
    const r = actionsFor({ ...base, botTask: true });
    expect(ids(r.actions)).toEqual(['open_task', 'not_now']);
    expect(ids(r.more_actions)).toEqual(['matters_more']);
  });
  it('after three Not nows there is no Let it go (it is Bast\'s task)', () => {
    expect(ids(actionsFor({ ...base, botTask: true, parkCount: 3 }).actions)).toEqual(['open_task']);
  });
});

describe('Slice 4a: owed thread buttons', () => {
  const t = { ...base, kind: 'thread' as const, threadUrl: 'https://thread' };
  it('no draft: Draft it now, Open the thread, Not now; No reply needed under More', () => {
    const r = actionsFor({ ...t, owedThread: { state: null, suggestion: false } });
    expect(ids(r.actions)).toEqual(['draft_now', 'open_thread', 'not_now']);
    expect(ids(r.more_actions)).toContain('no_reply_needed');
  });
  it('a request already waiting does not offer Draft it now again', () => {
    const r = actionsFor({ ...t, owedThread: { state: 'drafting', suggestion: false } });
    expect(ids(r.actions)).toEqual(['open_thread', 'not_now']);
  });
  it('draft ready: Open the draft, Needs thought, Not now', () => {
    const r = actionsFor({ ...t, draftUrl: 'https://thread', owedThread: { state: 'draft_ready', suggestion: false } });
    expect(ids(r.actions)).toEqual(['open_draft', 'needs_thought', 'not_now']);
    expect(r.actions[0].href).toBe('https://thread');
  });
  it('needs thought with a suggestion: Go with that, Open the thread, Not now; More has Draft it now and No reply needed', () => {
    const r = actionsFor({ ...t, owedThread: { state: 'needs_thought', suggestion: true } });
    expect(ids(r.actions)).toEqual(['go_with_that', 'open_thread', 'not_now']);
    expect(ids(r.more_actions).slice(0, 2)).toEqual(['draft_now', 'no_reply_needed']);
  });
  it('needs thought without a suggestion has no Go with that', () => {
    const r = actionsFor({ ...t, owedThread: { state: 'needs_thought', suggestion: false } });
    expect(ids(r.actions)).toEqual(['open_thread', 'not_now']);
    expect(ids([...r.actions, ...r.more_actions])).not.toContain('go_with_that');
  });
  it('his own draft keeps the Slice 1 buttons', () => {
    const r = actionsFor({ ...t, draftUrl: 'https://draft', owedThread: { state: 'his_draft', suggestion: false } });
    expect(ids(r.actions)).toEqual(['open_draft', 'no_reply_needed', 'not_now']);
    const older = actionsFor({ ...t, draftUrl: 'https://draft', owedThread: { state: 'his_draft_older', suggestion: false } });
    expect(ids(older.actions)).toEqual(['open_draft', 'no_reply_needed', 'not_now']);
  });
  it('no button can send: no id or label says send', () => {
    for (const state of [null, 'drafting', 'draft_ready', 'stale_draft', 'needs_thought', 'his_draft'] as const) {
      const r = actionsFor({ ...t, draftUrl: 'https://d', owedThread: { state, suggestion: true } });
      for (const a of [...r.actions, ...r.more_actions]) expect(`${a.id} ${a.label}`).not.toMatch(/send/i);
    }
  });
});


describe('actionsFor: Slice 6a', () => {
  it('a site down row: open the mail, open the site, then Not an emergency; never Handled, Done or Not now', () => {
    const r = actionsFor({ ...base, kind: 'site', emergency: true, mailUrl: 'https://mail/x', siteUrl: 'https://jillscafe.com/' });
    expect(r.actions.map((a) => [a.id, a.href])).toEqual([
      ['open_thread', 'https://mail/x'],
      ['open_site', 'https://jillscafe.com/'],
      ['not_emergency', null],
    ]);
    expect(ids(actionsFor({ ...base, kind: 'site', emergency: true, siteUrl: 'https://jillscafe.com/' }).actions)).toEqual(['open_site', 'not_emergency']);
  });
  it('the hands row has one button, Not this week, filled when it is the top Next row, and no More', () => {
    expect(actionsFor({ ...base, kind: 'hands' })).toEqual({ actions: [{ id: 'not_this_week', label: 'Not this week', filled: false, href: null }], more_actions: [] });
    expect(actionsFor({ ...base, kind: 'hands', filledFirst: true }).actions[0].filled).toBe(true);
  });
});

describe('Slice 8b: a project next step', () => {
  it('Open the project, I did this, Not now; This matters more under More; no arc, no Done, no I\'ll do it now', () => {
    const r = actionsFor({ ...base, kind: 'step' });
    expect(ids(r.actions)).toEqual(['open_project', 'step_done', 'not_now']);
    expect(r.actions.map((a) => a.label)).toEqual(['Open the project', 'I did this', 'Not now']);
    expect(ids(r.more_actions)).toEqual(['matters_more']);
  });
  it('the top Next row fills the first button, and a third Not now withdraws Not now without a Let it go', () => {
    expect(actionsFor({ ...base, kind: 'step', filledFirst: true }).actions[0]).toMatchObject({ id: 'open_project', filled: true });
    expect(ids(actionsFor({ ...base, kind: 'step', parkCount: 3 }).actions)).toEqual(['open_project', 'step_done']);
  });
});
