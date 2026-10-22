import { describe, it, expect } from 'vitest';
import {
  activityLabel,
  AWAITING_YOU_LABEL,
  FALLBACK_STATUS_LABEL,
  isRequestClosed,
  phaseStateLabel,
  projectStatusLabel,
  REQUEST_LABELS,
  requestState,
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

describe('requestState (spec 2.6)', () => {
  const staged = { staging_preview_url: 'https://staging.example.com', status: 'review' };

  it('abandoned is Closed, quiet, and beats everything', () => {
    expect(requestState({ ...staged, status: 'abandoned', tags: ['emergency', 'quote'] })).toEqual({ label: 'Closed', tone: 'quiet' });
  });

  it('staged and not client-approved is Ready for your review, attention', () => {
    expect(requestState({ ...staged })).toEqual({ label: 'Ready for your review', tone: 'attention' });
    expect(requestState({ ...staged, status: 'done', tags: ['quote'] })).toEqual({ label: 'Ready for your review', tone: 'attention' });
  });

  it('approved and still in review reads Approved. Going live soon., moving tone', () => {
    const want = { label: 'Approved. Going live soon.', tone: 'moving' };
    expect(requestState({ ...staged, client_approved_at: '2026-10-21T00:00:00Z' })).toEqual(want);
    expect(requestState({ ...staged, tags: ['client-approved'] })).toEqual(want);
    expect(requestState({ status: 'review', client_approved_at: '2026-10-21T00:00:00Z' })).toEqual(want);
    // Once it is live (done) it reads Done; abandoned stays Closed.
    expect(requestState({ ...staged, status: 'done', client_approved_at: '2026-10-21T00:00:00Z' })).toEqual({ label: 'Done', tone: 'done' });
    expect(requestState({ status: 'abandoned', client_approved_at: '2026-10-21T00:00:00Z' })).toEqual({ label: 'Closed', tone: 'quiet' });
    expect(taskStatusLabel('review', false, true)).toBe('Approved. Going live soon.');
    expect(isRequestClosed({ ...staged, client_approved_at: '2026-10-21T00:00:00Z' })).toBe(false);
  });

  it('done, or client-approved, is Done', () => {
    expect(requestState({ status: 'done' })).toEqual({ label: 'Done', tone: 'done' });
    expect(requestState({ status: 'in_progress', client_approved_at: '2026-10-20T00:00:00Z' })).toEqual({ label: 'Done', tone: 'done' });
    expect(requestState({ ...staged, status: 'done', client_approved_at: '2026-10-20T00:00:00Z' })).toEqual({ label: 'Done', tone: 'done' });
    // Already published (approved) work is no longer awaiting the client; a done task reads Done.
    expect(requestState({ ...staged, status: 'done', approved: true })).toEqual({ label: 'Done', tone: 'done' });
  });

  it('awaiting-clarification is Needs your answer, attention', () => {
    expect(requestState({ status: 'in_progress', tags: ['awaiting-clarification', 'quote'] })).toEqual({ label: 'Needs your answer', tone: 'attention' });
  });

  it('quote is "We will quote this", and beats emergency', () => {
    expect(requestState({ status: 'not_started', tags: ['quote', 'needs-mike'] })).toEqual({ label: 'We will quote this', tone: 'quote' });
    expect(requestState({ status: 'not_started', tags: ['emergency', 'quote'] }).tone).toBe('quote');
  });

  it('emergency is urgent', () => {
    expect(requestState({ status: 'not_started', tags: ['emergency'] })).toEqual({ label: 'Urgent: the team is on it', tone: 'urgent' });
  });

  it('in_progress, blocked and review are In progress, moving', () => {
    for (const status of ['in_progress', 'blocked', 'review']) {
      expect(requestState({ status })).toEqual({ label: 'In progress', tone: 'moving' });
    }
  });

  it('everything else is Received, quiet', () => {
    expect(requestState({ status: 'not_started' })).toEqual({ label: 'Received', tone: 'quiet' });
    expect(requestState({})).toEqual({ label: 'Received', tone: 'quiet' });
  });

  it('review without a staged preview is In progress, not Ready for your review', () => {
    expect(requestState({ status: 'review' }).label).toBe('In progress');
  });

  it('never leaks a tag name, staff name or em dash in any label', () => {
    for (const label of Object.values(REQUEST_LABELS)) {
      expect(label).not.toMatch(/[—–]/);
      expect(label).not.toMatch(/bast|needs-mike|portal-chat|kind:/i);
    }
  });

  it('isRequestClosed is true for Closed and Done only', () => {
    expect(isRequestClosed({ status: 'abandoned' })).toBe(true);
    expect(isRequestClosed({ status: 'done' })).toBe(true);
    expect(isRequestClosed({ ...staged })).toBe(false);
    expect(isRequestClosed({ status: 'in_progress' })).toBe(false);
  });
});
