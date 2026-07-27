import { describe, it, expect } from 'vitest';
import { cronKey, visibleCronChips, type CronChipStateRow } from '../cron-chips';
import type { ErroringCron } from '@/components/domain/oracle/oracle-logic';

function cron(overrides: Partial<ErroringCron> = {}): ErroringCron {
  return { machineName: 'nexus', title: 'email-check', attentionReason: 'boom', ...overrides };
}

describe('cronKey', () => {
  it('combines machine name and title', () => {
    expect(cronKey('nexus', 'email-check')).toBe('nexus::email-check');
  });
});

describe('visibleCronChips', () => {
  const nowMs = new Date('2026-07-27T12:00:00.000Z').getTime();

  it('shows a cron with no saved state', () => {
    expect(visibleCronChips([cron()], [], nowMs)).toHaveLength(1);
  });

  it('hides a cron snoozed into the future', () => {
    const states: CronChipStateRow[] = [
      { cron_key: 'nexus::email-check', snoozed_until: '2026-07-28T00:00:00.000Z', dismissed_reason: null },
    ];
    expect(visibleCronChips([cron()], states, nowMs)).toHaveLength(0);
  });

  it('shows a cron whose snooze has already elapsed', () => {
    const states: CronChipStateRow[] = [
      { cron_key: 'nexus::email-check', snoozed_until: '2026-07-01T00:00:00.000Z', dismissed_reason: null },
    ];
    expect(visibleCronChips([cron()], states, nowMs)).toHaveLength(1);
  });

  it('hides a cron whose current reason matches the dismissed reason', () => {
    const states: CronChipStateRow[] = [
      { cron_key: 'nexus::email-check', snoozed_until: null, dismissed_reason: 'boom' },
    ];
    expect(visibleCronChips([cron({ attentionReason: 'boom' })], states, nowMs)).toHaveLength(0);
  });

  it('re-shows a dismissed cron once its reason changes (a re-fire)', () => {
    const states: CronChipStateRow[] = [
      { cron_key: 'nexus::email-check', snoozed_until: null, dismissed_reason: 'boom' },
    ];
    expect(visibleCronChips([cron({ attentionReason: 'a different failure' })], states, nowMs)).toHaveLength(1);
  });

  it('a different cron (different key) is unaffected by another cron\'s state', () => {
    const states: CronChipStateRow[] = [
      { cron_key: 'nexus::email-check', snoozed_until: '2026-12-01T00:00:00.000Z', dismissed_reason: null },
    ];
    const other = cron({ title: 'calendar-sync' });
    expect(visibleCronChips([other], states, nowMs)).toHaveLength(1);
  });
});
