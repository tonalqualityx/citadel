import { describe, it, expect } from 'vitest';
import { projectHasPlanLinks, requirementProgress } from '../requirement-progress';
import { triageDateFlags } from '../triage-date-reason';

const t = (status: string, ...ids: string[]) => ({ status, plan_item_ids: ids });

describe('requirement progress from linked tasks', () => {
  it('shows nothing unless some task carries a plan link', () => {
    expect(projectHasPlanLinks([t('done'), t('not_started')])).toBe(false);
    expect(projectHasPlanLinks([t('done'), t('not_started', 'a')])).toBe(true);
    expect(projectHasPlanLinks([])).toBe(false);
  });
  it('no task names the line: not started', () => {
    expect(requirementProgress([t('done', 'b')], 'a')).toEqual({ progress: 'not_started', done: 0, total: 0 });
  });
  it('every linked task done: done; abandoned tasks do not count', () => {
    expect(requirementProgress([t('done', 'a'), t('done', 'a', 'b'), t('abandoned', 'a')], 'a')).toEqual({ progress: 'done', done: 2, total: 2 });
    expect(requirementProgress([t('abandoned', 'a')], 'a').progress).toBe('not_started');
  });
  it('some done or some started: in progress; all waiting: not started', () => {
    expect(requirementProgress([t('done', 'a'), t('not_started', 'a')], 'a')).toEqual({ progress: 'in_progress', done: 1, total: 2 });
    expect(requirementProgress([t('in_progress', 'a'), t('not_started', 'a')], 'a').progress).toBe('in_progress');
    expect(requirementProgress([t('review', 'a')], 'a').progress).toBe('in_progress');
    expect(requirementProgress([t('not_started', 'a'), t('blocked', 'a')], 'a').progress).toBe('not_started');
  });
});

describe('the reason for a dated Triage card question', () => {
  it('reads the kind from the cause key and the date from the project', () => {
    expect(triageDateFlags(['triage-date:start:abc'], '2026-11-10', '2026-11-30')).toEqual([{ kind: 'start', reason: 'Start date was Nov 10, and this card is still waiting for you.' }]);
    expect(triageDateFlags(['triage-date:launch:abc', 'triage-date:launch:abc'], '2026-11-10', '2026-11-30').map((f) => f.kind)).toEqual(['launch']);
    expect(triageDateFlags(['triage-date:launch:abc'], null, '2026-11-30')[0].reason).toContain('Launch is Nov 30');
  });
  it('ignores every other cause key and a missing one', () => {
    expect(triageDateFlags(['dox:g3:x', null, 'triage-date:other:abc', 'triage-date:'], '2026-11-10', null)).toEqual([]);
  });
  it('a start flag with no date still reads in plain words', () => {
    expect(triageDateFlags(['triage-date:start:abc'], null, null)[0].reason).toBe('The start date has passed, and this card is still waiting for you.');
  });
});
