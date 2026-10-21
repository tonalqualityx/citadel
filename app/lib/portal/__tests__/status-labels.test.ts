import { describe, it, expect } from 'vitest';
import {
  activityLabel,
  AWAITING_YOU_LABEL,
  FALLBACK_STATUS_LABEL,
  phaseStateLabel,
  projectStatusLabel,
  taskStatusLabel,
} from '../status-labels';

describe('projectStatusLabel', () => {
  it('maps visible project statuses to plain phrases (spec section 3)', () => {
    expect(projectStatusLabel('ready')).toBe('Starting soon');
    expect(projectStatusLabel('in_progress')).toBe('In progress');
    expect(projectStatusLabel('review')).toBe('In review');
    expect(projectStatusLabel('done')).toBe('Complete');
  });

  it('never returns a raw enum value for hidden or unknown statuses', () => {
    for (const status of ['quote', 'queue', 'suspended', 'cancelled', 'weird', '', null, undefined]) {
      expect(projectStatusLabel(status as string)).toBe(FALLBACK_STATUS_LABEL);
    }
  });
});

describe('taskStatusLabel', () => {
  it('maps task statuses, blocked reads as In progress', () => {
    expect(taskStatusLabel('not_started')).toBe('Starting soon');
    expect(taskStatusLabel('in_progress')).toBe('In progress');
    expect(taskStatusLabel('blocked')).toBe('In progress');
    expect(taskStatusLabel('review')).toBe('In review');
    expect(taskStatusLabel('done')).toBe('Complete');
  });

  it('shows staged-and-unapproved work as ready for review, not Complete', () => {
    expect(taskStatusLabel('done', true)).toBe(AWAITING_YOU_LABEL);
    expect(taskStatusLabel('review', true)).toBe(AWAITING_YOU_LABEL);
  });
});

describe('copy rules', () => {
  const all = [
    ...['ready', 'in_progress', 'review', 'done', 'x'].map((s) => projectStatusLabel(s)),
    ...['not_started', 'in_progress', 'blocked', 'review', 'done', 'abandoned', 'x'].map((s) => taskStatusLabel(s)),
    AWAITING_YOU_LABEL,
    ...(['done', 'current', 'upcoming'] as const).map(phaseStateLabel),
    ...(['task_completed', 'task_approved', 'article_published'] as const).map(activityLabel),
  ];

  it('has no em dashes, no estimates and no staff or tool names', () => {
    for (const label of all) {
      expect(label).not.toMatch(/[—–]/);
      expect(label).not.toMatch(/bast|estimate|minute|hour/i);
    }
  });
});
