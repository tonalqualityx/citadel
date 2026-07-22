import { describe, it, expect } from 'vitest';
import { formatNewestAt, intakeSummaryLine } from '../intake-drawer-logic';

describe('formatNewestAt', () => {
  it('formats an ISO instant in the given zone', () => {
    // 20:00 UTC = 4pm ET (EDT, UTC-4)
    expect(formatNewestAt('2026-07-21T20:00:00.000Z', 'America/New_York')).toBe('4:00 PM');
  });

  it('formats the same instant differently in a different zone', () => {
    // 20:00 UTC = 5am next day PKT (UTC+5) — Karachi has no DST
    expect(formatNewestAt('2026-07-21T20:00:00.000Z', 'Asia/Karachi')).toBe('1:00 AM');
  });
});

describe('intakeSummaryLine', () => {
  it('shows just the count when there are zero items', () => {
    expect(intakeSummaryLine(0, null, 'America/New_York')).toBe('📬 Intake · 0');
  });

  it('includes the formatted newest time when count > 0', () => {
    expect(intakeSummaryLine(3, '2026-07-21T20:00:00.000Z', 'America/New_York')).toBe(
      '📬 Intake · 3 · newest 4:00 PM'
    );
  });

  it('falls back to just the count if newestAt is somehow null despite a nonzero count', () => {
    expect(intakeSummaryLine(2, null, 'America/New_York')).toBe('📬 Intake · 2');
  });
});
