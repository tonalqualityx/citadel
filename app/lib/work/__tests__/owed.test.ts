// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { askIsMine, type LinkedTaskFacts } from '../owed';

const facts = (entries: Record<string, LinkedTaskFacts>) => new Map(Object.entries(entries));

describe('askIsMine: the one rule for "is this email mine to answer"', () => {
  it('an ask with no task is his', () => {
    expect(askIsMine({ task_id: null }, facts({}))).toBe(true);
  });

  it('an ask linked to a live task of any status is not his', () => {
    for (const status of ['not_started', 'in_progress', 'review', 'blocked', 'done', 'abandoned']) {
      expect(askIsMine({ task_id: 't1' }, facts({ t1: { is_deleted: false, status } }))).toBe(false);
    }
  });

  it('an ask whose task is deleted or missing is his again', () => {
    expect(askIsMine({ task_id: 't1' }, facts({ t1: { is_deleted: true, status: 'done' } }))).toBe(true);
    expect(askIsMine({ task_id: 't1' }, facts({}))).toBe(true);
  });

  it('an urgent ask keeps its emergency path even when linked', () => {
    expect(askIsMine({ task_id: 't1', is_urgent: true }, facts({ t1: { is_deleted: false, status: 'in_progress' } }))).toBe(true);
  });

  it('a security-tagged task still carries its ask (the ask stays visible through the security task)', () => {
    expect(askIsMine({ task_id: 't1' }, facts({ t1: { is_deleted: false, status: 'done', tags: ['security'] } }))).toBe(false);
  });
});

// Work stage B: the owed rule
import { askIsOwed, askShowsAsMeeting } from '../owed';

describe('askIsOwed: reply_mike, an undecided old row, or work with no live task is owed', () => {
  const none = facts({});
  it.each([
    ['reply_mike', true],
    [null, true],
    [undefined, true],
    ['no_action', false],
    ['work', true],
    ['meeting', false],
    ['waiting_them', false],
    ['emergency', false],
  ])('disposition %s -> owed %s', (disposition, owed) => {
    expect(askIsOwed({ task_id: null, disposition }, none)).toBe(owed);
  });

  it('an ask a live task carries is never owed, whatever its disposition', () => {
    expect(askIsOwed({ task_id: 't1', disposition: 'reply_mike' }, facts({ t1: { is_deleted: false, status: 'in_progress' } }))).toBe(false);
    expect(askIsOwed({ task_id: 't1', disposition: null }, facts({ t1: { is_deleted: false, status: 'done' } }))).toBe(false);
  });

  it('a deleted task gives the ask back (owed again when reply_mike)', () => {
    expect(askIsOwed({ task_id: 't1', disposition: 'reply_mike' }, facts({ t1: { is_deleted: true } }))).toBe(true);
  });

  it('work with no live task linked is owed exactly like reply_mike (a failed follow-up link must not hide the email)', () => {
    expect(askIsOwed({ task_id: null, disposition: 'work' }, none)).toBe(askIsOwed({ task_id: null, disposition: 'reply_mike' }, none));
    expect(askIsOwed({ task_id: null, disposition: 'work' }, none)).toBe(true);
    // linked to a task that is deleted, or a task id that is missing: the work is gone, the email is his again
    expect(askIsOwed({ task_id: 't1', disposition: 'work' }, facts({ t1: { is_deleted: true } }))).toBe(true);
    expect(askIsOwed({ task_id: 't1', disposition: 'work' }, none)).toBe(true);
  });

  it('work with a live task linked is carried by the task, never owed', () => {
    for (const status of ['not_started', 'in_progress', 'review', 'blocked', 'done', 'abandoned']) {
      expect(askIsOwed({ task_id: 't1', disposition: 'work' }, facts({ t1: { is_deleted: false, status } }))).toBe(false);
    }
  });

  it('the other non-owed dispositions stay not owed with no task', () => {
    for (const disposition of ['no_action', 'meeting', 'waiting_them', 'emergency']) {
      expect(askIsOwed({ task_id: null, disposition }, none)).toBe(false);
    }
  });

  it('a meeting ask shows as a meeting row, never as owed', () => {
    expect(askShowsAsMeeting({ task_id: null, disposition: 'meeting' }, none)).toBe(true);
    expect(askShowsAsMeeting({ task_id: null, disposition: 'reply_mike' }, none)).toBe(false);
    expect(askShowsAsMeeting({ task_id: 't1', disposition: 'meeting' }, facts({ t1: { is_deleted: false, status: 'in_progress' } }))).toBe(false);
  });
});
