import { describe, it, expect } from 'vitest';
import { cancelMode, workMayBeUnderWay, wasCancelledByClient } from '../cancel-state';
import { requestState, isRequestClosed, activityLabel, REQUEST_LABELS, CLIENT_CANCELLED_TAG } from '../status-labels';
import { CANCEL_CONFIRM, CANCEL_LINE, CANCEL_LINK, changeToText } from '../cancel-copy';

describe('cancelMode', () => {
  it('allows cancelling anything not started, in progress, blocked or staged', () => {
    for (const status of ['not_started', 'in_progress', 'blocked', 'review']) expect(cancelMode({ status, tags: [] })).toBe('allowed');
    expect(cancelMode({ status: 'review', tags: [], client_approved_at: null })).toBe('allowed');
  });
  it('offers a change, not a cancel, once it is live', () => {
    expect(cancelMode({ status: 'done', tags: [] })).toBe('live');
    expect(cancelMode({ status: 'done', client_approved_at: '2026-10-21T00:00:00Z' })).toBe('live');
  });
  it('approved, not yet live work can still be cancelled; only done is live', () => {
    expect(cancelMode({ status: 'review', tags: ['client-approved'] })).toBe('allowed');
    expect(cancelMode({ status: 'review', client_approved_at: new Date() })).toBe('allowed');
    expect(cancelMode({ status: 'done', tags: ['client-approved'] })).toBe('live');
  });
  it('a cancelled request stays cancelled', () => {
    expect(cancelMode({ status: 'abandoned', tags: [CLIENT_CANCELLED_TAG] })).toBe('cancelled');
    expect(cancelMode({ status: 'abandoned', tags: [] })).toBe('cancelled');
  });
  it('only work that may be under way tells a person to stop', () => {
    expect(workMayBeUnderWay('not_started')).toBe(false);
    for (const s of ['in_progress', 'blocked', 'review']) expect(workMayBeUnderWay(s)).toBe(true);
    expect(workMayBeUnderWay(null)).toBe(false);
  });
  it('knows who ended it', () => {
    expect(wasCancelledByClient({ tags: ['x', CLIENT_CANCELLED_TAG] })).toBe(true);
    expect(wasCancelledByClient({ tags: [] })).toBe(false);
    expect(wasCancelledByClient({})).toBe(false);
  });
});

describe('cancelled labels', () => {
  it('reads Cancelled by you, quiet, and beats every other state', () => {
    const cancelled = { status: 'abandoned', tags: [CLIENT_CANCELLED_TAG, 'emergency', 'awaiting-clarification'], staging_preview_url: 'https://x.test', client_approved_at: '2026-10-21T00:00:00Z' };
    expect(requestState(cancelled)).toEqual({ label: REQUEST_LABELS.cancelled, tone: 'quiet' });
    expect(REQUEST_LABELS.cancelled).toBe('Cancelled by you');
  });
  it('an abandoned task staff closed still reads Closed', () => {
    expect(requestState({ status: 'abandoned', tags: [] })).toEqual({ label: 'Closed', tone: 'quiet' });
  });
  it('is closed, so Needs you and Moving now skip it', () => {
    expect(isRequestClosed({ status: 'abandoned', tags: [CLIENT_CANCELLED_TAG] })).toBe(true);
    expect(requestState({ status: 'abandoned', tags: [CLIENT_CANCELLED_TAG, 'awaiting-clarification'] }).tone).not.toBe('attention');
  });
  it('the history line and the fixed copy', () => {
    expect(activityLabel('task_cancelled')).toBe('You cancelled');
    expect(CANCEL_LINE).toBe('You cancelled this request.');
    expect(CANCEL_LINK).toBe('Cancel this request');
    expect(CANCEL_CONFIRM).toBe('Cancel it? This cannot be undone from here.');
    expect(changeToText('Update hours')).toBe('Change to: Update hours');
  });
});
