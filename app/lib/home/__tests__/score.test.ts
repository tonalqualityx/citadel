import { describe, it, expect } from 'vitest';
import {
  calendarDaysUntilDue,
  dueCivil,
  hardDateOfTask,
  normalizeDueDate,
  reviewUnblocks,
  scoreCrisis,
  scoreReview,
  scoreSession,
  scoreTask,
  scoreThread,
  scoreWait,
} from '../score';
import { IMPORTANCE } from '../rules';
import { NOW, d, makeAsk, makeClient, makeFold, makeProject, makeSession, makeTask, makeThread, makeWait } from './fixtures/tonight';

// NOW is Monday 2026-11-09 18:59 in New York (after 17:00, so today's business day is complete).

describe('importance parts', () => {
  const active = makeClient('Active Co');

  it('a task with nothing attached is the base 10, class 4, urgency 10', () => {
    const s = scoreTask(makeTask(), NOW);
    expect(s.importance).toBe(IMPORTANCE.base);
    expect(s.klass).toBe(4);
    expect(s.urgency).toBe(10);
  });

  it('client trust: +30 active client, +15 promised, +10 contact; the part is capped at 45', () => {
    const t = scoreTask(makeTask({ client: active }), NOW);
    expect(t.clientTrust).toBe(30);
    expect(scoreTask(makeTask({ client: active, promised_to: 'Gene' }), NOW).clientTrust).toBe(45);
    expect(scoreTask(makeTask({ client: active, requested_by_contact_id: 'c' }), NOW).clientTrust).toBe(40);
    const all = scoreTask(makeTask({ client: active, promised_to: 'Gene', client_visible: true }), NOW);
    expect(all.clientTrust).toBe(45);
    expect(all.importance).toBe(10 + 45);
  });

  it('an inactive client earns no client-trust points', () => {
    const paused = makeClient('Paused Co', { status: 'inactive' as never });
    expect(scoreTask(makeTask({ client: paused }), NOW).clientTrust).toBe(0);
  });

  it('money and lifelines: tags 25, link 15, site 10, capped at 25', () => {
    expect(scoreTask(makeTask({ tags: ['security'] }), NOW).money).toBe(25);
    expect(scoreTask(makeTask({ tags: ['job-watch:claude-signin'] }), NOW).money).toBe(25);
    expect(scoreTask(makeTask({ charter_id: 'c' }), NOW).money).toBe(15);
    expect(scoreTask(makeTask({ billing_amount: 100 }), NOW).money).toBe(15);
    expect(scoreTask(makeTask({ site_id: 's' }), NOW).money).toBe(10);
    expect(scoreTask(makeTask({ tags: ['lifeline'], charter_id: 'c', site_id: 's' }), NOW).money).toBe(25);
  });

  it('unblocks: +7 per open blocked task, capped at 14', () => {
    expect(scoreTask(makeTask({ open_blocking_count: 1 }), NOW).unblocks).toBe(7);
    expect(scoreTask(makeTask({ open_blocking_count: 5 }), NOW).unblocks).toBe(14);
  });

  it('other ventures are capped at 20', () => {
    const saiph = makeClient('Saiph Grants');
    const s = scoreTask(makeTask({ client: saiph, promised_to: 'X', tags: ['security'] }), NOW);
    expect(s.importance).toBe(20);
    expect(s.venture).toBe(true);
  });

  it('review sign-off unblocks 6 plus 1 per 5 pieces, session ask 10 and +15 when client blocking', () => {
    expect(reviewUnblocks(39)).toBe(13);
    expect(scoreReview(makeFold({}, 39), NOW).unblocks).toBe(13);
    const s = scoreSession(makeSession({ ask_severity: 'client_blocking' }), NOW);
    expect(s.unblocks).toBe(10);
    expect(s.clientTrust).toBe(15);
    expect(scoreSession(makeSession({ ask_severity: 'internal' }), NOW).clientTrust).toBe(0);
  });

  it('a wait: client +30, blocks_client +15, charter +15 money', () => {
    const s = scoreWait(makeWait({ client: active, blocks_client: true, charter_id: 'c' }), NOW);
    expect(s.clientTrust).toBe(45);
    expect(s.money).toBe(15);
  });
});

describe('consequence class', () => {
  const active = makeClient('Active Co');
  it('class 1 from client trust 30 or more', () => {
    expect(scoreTask(makeTask({ client: active }), NOW).klass).toBe(1);
  });
  it('class 2 from money 15 or more', () => {
    expect(scoreTask(makeTask({ charter_id: 'c' }), NOW).klass).toBe(2);
    expect(scoreTask(makeTask({ site_id: 's' }), NOW).klass).toBe(4); // 10 is not enough
  });
  it('class 2 from a hard date 7 calendar days away or less, 4 beyond', () => {
    const near = makeTask({ promised_to: 'Gene', due_date: d('2026-11-16T00:00:00.000Z') });
    const far = makeTask({ promised_to: 'Gene', due_date: d('2026-11-17T00:00:00.000Z') });
    expect(scoreTask(near, NOW).klass).toBe(2);
    expect(scoreTask(far, NOW).klass).toBe(4);
  });
  it('class 3 when it unblocks something, else 4', () => {
    expect(scoreTask(makeTask({ open_blocking_count: 1 }), NOW).klass).toBe(3);
    expect(scoreSession(makeSession(), NOW).klass).toBe(3);
  });
  it('class 1 beats class 2 when both apply', () => {
    expect(scoreTask(makeTask({ client: active, tags: ['security'] }), NOW).klass).toBe(1);
  });
});

describe('urgency from a hard date', () => {
  const due = (iso: string) => scoreTask(makeTask({ promised_to: 'Gene', due_date: d(iso) }), NOW).urgency;
  it('past 100', () => expect(due('2026-11-08T00:00:00.000Z')).toBe(100));
  it('today and up to 2 business days: 90', () => {
    expect(due('2026-11-09T00:00:00.000Z')).toBe(90);
    expect(due('2026-11-11T00:00:00.000Z')).toBe(90);
  });
  it('up to 5 business days: 70', () => {
    expect(due('2026-11-12T00:00:00.000Z')).toBe(70);
    expect(due('2026-11-16T00:00:00.000Z')).toBe(70);
  });
  it('up to 10 business days: 50', () => {
    expect(due('2026-11-17T00:00:00.000Z')).toBe(50);
    expect(due('2026-11-23T00:00:00.000Z')).toBe(50);
  });
  it('further out: 20', () => expect(due('2026-11-24T00:00:00.000Z')).toBe(20));
  it('a due date with no promise and no lifeline tag is ignored', () => {
    const s = scoreTask(makeTask({ due_date: d('2026-11-01T00:00:00.000Z') }), NOW);
    expect(s.hardDate).toBeNull();
    expect(s.urgency).toBe(10);
  });
  it('a job-watch tag makes the due date hard', () => {
    const s = scoreTask(makeTask({ tags: ['job-watch'], due_date: d('2026-11-14T00:00:00.000Z') }), NOW);
    expect(s.hardDate).not.toBeNull();
    expect(s.urgency).toBe(70); // Saturday: 4 business days away
  });
});

describe('date-only due dates (stored at midnight UTC)', () => {
  it('count as their own calendar day, not the evening before in New York', () => {
    const saturday = d('2026-11-14T00:00:00.000Z');
    expect(dueCivil(saturday)).toEqual({ y: 2026, m: 11, d: 14 });
    expect(calendarDaysUntilDue(saturday, NOW)).toBe(5);
    expect(normalizeDueDate(saturday).toISOString()).toBe('2026-11-14T16:00:00.000Z');
  });
  it('a real instant is converted to New York time', () => {
    const lateFriday = d('2026-11-14T03:30:00.000Z'); // 10:30 pm Friday Nov 13 in New York
    expect(dueCivil(lateFriday)).toEqual({ y: 2026, m: 11, d: 13 });
    expect(normalizeDueDate(lateFriday)).toBe(lateFriday);
  });
  it('hardDateOfTask returns the normalized date', () => {
    const task = makeTask({ promised_to: 'Gene', due_date: d('2026-11-14T00:00:00.000Z') });
    expect(hardDateOfTask(task)?.toISOString()).toBe('2026-11-14T16:00:00.000Z');
  });
});

describe('urgency from a person waiting (business days elapsed)', () => {
  const waited = (iso: string) =>
    scoreTask(makeTask({ promised_to: 'Gene', clock_started_at: d(iso) }), NOW).urgency;
  it('0 days 10', () => expect(waited('2026-11-09T14:00:00Z')).toBe(10));
  it('1 day 30', () => expect(waited('2026-11-06T14:00:00Z')).toBe(30));
  it('3 days 50', () => expect(waited('2026-11-04T14:00:00Z')).toBe(50));
  it('5 days 65', () => expect(waited('2026-11-02T14:00:00Z')).toBe(65));
  it('10 days 80', () => expect(waited('2026-10-26T14:00:00Z')).toBe(80));
  it('20 or more days 90', () => expect(waited('2026-10-12T14:00:00Z')).toBe(90));
  it('a task nobody waits on does not climb', () => {
    expect(scoreTask(makeTask({ clock_started_at: d('2026-10-01T14:00:00Z') }), NOW).urgency).toBe(10);
  });
  it('the highest of date and waiting wins', () => {
    const s = scoreTask(
      makeTask({ promised_to: 'Gene', due_date: d('2026-11-24T00:00:00.000Z'), clock_started_at: d('2026-10-12T14:00:00Z') }),
      NOW,
    );
    expect(s.urgency).toBe(90);
  });
});

describe('threads, crisis mail and waits', () => {
  it('a thread uses its newest ask for the clock and adds 10 for a message in the last 24 hours', () => {
    const old = scoreThread(makeThread({ received_at: d('2026-11-02T15:00:00Z') }), NOW);
    expect(old.urgency).toBe(65);
    const fresh = scoreThread(makeThread({ received_at: d('2026-11-09T20:00:00Z') }), NOW);
    expect(fresh.urgency).toBe(20);
  });
  it('a thread with a client is class 1', () => {
    const c = makeClient('North Star');
    expect(scoreThread(makeThread({ client: c }), NOW).klass).toBe(1);
  });
  it('crisis mail waits from its received time', () => {
    expect(scoreCrisis(makeAsk({ received_at: d('2026-11-02T15:00:00Z') }), NOW).urgency).toBe(65);
  });
  it('a wait with a client waits from client_waiting_since, else from due_at once passed', () => {
    const c = makeClient('Co');
    const a = scoreWait(makeWait({ client: c, client_waiting_since: d('2026-11-02T15:00:00Z') }), NOW);
    expect(a.urgency).toBe(65);
    const b = scoreWait(makeWait({ client: c, due_at: d('2026-11-04T14:00:00Z') }), NOW);
    expect(b.urgency).toBe(50);
    const notDue = scoreWait(makeWait({ client: c, due_at: d('2026-12-04T22:00:00Z') }), NOW);
    expect(notDue.urgency).toBe(10);
  });
  it('project ventures cap the thread too', () => {
    const p = makeProject('KNT articles');
    const s = scoreThread(makeThread({ project: p, client: makeClient('X') }), NOW);
    expect(s.venture).toBe(true);
    expect(s.importance).toBe(20);
  });
});
