import { describe, it, expect } from 'vitest';
import {
  formatNewestAt,
  intakeSummaryLine,
  laneForAsk,
  intakeChipLine,
  groupAsksByLane,
  formatProposedEvent,
  calendarButtonState,
  type EmailAskLane,
} from '../intake-drawer-logic';

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

describe('laneForAsk', () => {
  it('null intent renders as general', () => {
    expect(laneForAsk({ intent: null })).toBe('general');
  });

  it('passes through an explicit intent', () => {
    expect(laneForAsk({ intent: 'meeting' })).toBe('meeting');
    expect(laneForAsk({ intent: 'sales' })).toBe('sales');
    expect(laneForAsk({ intent: 'general' })).toBe('general');
  });
});

describe('intakeChipLine', () => {
  it('renders one quiet count per non-empty lane, in general/meeting/sales order', () => {
    expect(intakeChipLine({ general: 4, meeting: 1, sales: 2 })).toBe('📬 4 · 🤝 1 · 💰 2');
  });

  it('skips zero-count lanes entirely (exception display, not a "0" badge)', () => {
    expect(intakeChipLine({ general: 4, meeting: 0, sales: 2 })).toBe('📬 4 · 💰 2');
    expect(intakeChipLine({ general: 0, meeting: 1, sales: 0 })).toBe('🤝 1');
  });

  it('falls back to the existing quiet all-zero line when every lane is zero', () => {
    expect(intakeChipLine({ general: 0, meeting: 0, sales: 0 })).toBe('📬 Intake · 0');
  });
});

describe('groupAsksByLane', () => {
  it('groups in Meeting, Sales, General order, skipping empty lanes', () => {
    const asks: { id: string; intent: EmailAskLane | null }[] = [
      { id: 'g1', intent: null },
      { id: 'm1', intent: 'meeting' },
      { id: 's1', intent: 'sales' },
      { id: 'g2', intent: 'general' },
    ];
    const groups = groupAsksByLane(asks);
    expect(groups.map((g) => g.lane)).toEqual(['meeting', 'sales', 'general']);
    expect(groups.map((g) => g.label)).toEqual(['Meeting', 'Sales', 'General']);
    expect(groups.find((g) => g.lane === 'general')!.asks.map((a) => a.id)).toEqual(['g1', 'g2']);
  });

  it('omits a lane with zero items rather than rendering an empty group', () => {
    const groups = groupAsksByLane<{ id: string; intent: EmailAskLane | null }>([{ id: 'g1', intent: null }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lane).toBe('general');
  });

  it('returns no groups at all when there are no items', () => {
    expect(groupAsksByLane([])).toEqual([]);
  });
});

describe('formatProposedEvent', () => {
  it('formats the parsed date/time/duration in the given zone', () => {
    // 2026-07-24 is a Friday; 19:30 UTC = 3:30 PM ET (EDT, UTC-4)
    expect(formatProposedEvent('2026-07-24T19:30:00.000Z', 45, 'America/New_York')).toBe(
      '📅 Fri 7/24 · 3:30 PM · 45m'
    );
  });

  it('omits the minutes segment when minutes is null', () => {
    expect(formatProposedEvent('2026-07-24T19:30:00.000Z', null, 'America/New_York')).toBe(
      '📅 Fri 7/24 · 3:30 PM'
    );
  });
});

describe('calendarButtonState', () => {
  it('is "none" when there is no parsed date at all (never guess)', () => {
    expect(
      calendarButtonState({ proposed_event_at: null, calendar_requested: false, calendar_event_id: null })
    ).toBe('none');
  });

  it('is "add" when a date is parsed and nothing has been requested yet', () => {
    expect(
      calendarButtonState({
        proposed_event_at: '2026-07-24T19:30:00.000Z',
        calendar_requested: false,
        calendar_event_id: null,
      })
    ).toBe('add');
  });

  it('is "queued" once calendar_requested is set, before the machine-side cron creates the event', () => {
    expect(
      calendarButtonState({
        proposed_event_at: '2026-07-24T19:30:00.000Z',
        calendar_requested: true,
        calendar_event_id: null,
      })
    ).toBe('queued');
  });

  it('is "added" once calendar_event_id is set, regardless of calendar_requested', () => {
    expect(
      calendarButtonState({
        proposed_event_at: '2026-07-24T19:30:00.000Z',
        calendar_requested: true,
        calendar_event_id: 'gcal-event-1',
      })
    ).toBe('added');
  });
});
