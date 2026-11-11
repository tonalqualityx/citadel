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
