import { describe, it, expect } from 'vitest';
import {
  formatNewestAt,
  intakeSummaryLine,
  laneForAsk,
  intakeChipLine,
  groupAsksByLane,
  formatProposedEvent,
  calendarButtonState,
  collapseAsks,
  collapseSummaryLine,
  seriesStem,
  type EmailAskLane,
  type CollapsibleAsk,
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

  it('Clarity Phase 6b — passes through the admin intent (never a null-fallback)', () => {
    expect(laneForAsk({ intent: 'admin' })).toBe('admin');
  });
});

describe('intakeChipLine', () => {
  it('renders one quiet count per non-empty lane, in admin/general/meeting/sales order', () => {
    expect(intakeChipLine({ admin: 3, general: 4, meeting: 1, sales: 2 })).toBe('🧾 3 · 📬 4 · 🤝 1 · 💰 2');
  });

  it('skips zero-count lanes entirely (exception display, not a "0" badge)', () => {
    expect(intakeChipLine({ admin: 0, general: 4, meeting: 0, sales: 2 })).toBe('📬 4 · 💰 2');
    expect(intakeChipLine({ admin: 0, general: 0, meeting: 1, sales: 0 })).toBe('🤝 1');
  });

  it('Clarity Phase 6b — admin renders FIRST when present, ahead of the other three lanes', () => {
    expect(intakeChipLine({ admin: 1, general: 4, meeting: 1, sales: 2 })).toBe('🧾 1 · 📬 4 · 🤝 1 · 💰 2');
  });

  it('falls back to the existing quiet all-zero line when every lane is zero', () => {
    expect(intakeChipLine({ admin: 0, general: 0, meeting: 0, sales: 0 })).toBe('📬 Intake · 0');
  });
});

describe('groupAsksByLane', () => {
  it('groups in Admin, Meeting, Sales, General order, skipping empty lanes', () => {
    const asks: { id: string; intent: EmailAskLane | null }[] = [
      { id: 'g1', intent: null },
      { id: 'a1', intent: 'admin' },
      { id: 'm1', intent: 'meeting' },
      { id: 's1', intent: 'sales' },
      { id: 'g2', intent: 'general' },
    ];
    const groups = groupAsksByLane(asks);
    expect(groups.map((g) => g.lane)).toEqual(['admin', 'meeting', 'sales', 'general']);
    expect(groups.map((g) => g.label)).toEqual(['Admin', 'Meeting', 'Sales', 'General']);
    expect(groups.find((g) => g.lane === 'general')!.asks.map((a) => a.id)).toEqual(['g1', 'g2']);
    expect(groups.find((g) => g.lane === 'admin')!.asks.map((a) => a.id)).toEqual(['a1']);
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

// ── Intake collapse (2026-08-03) ─────────────────────────────────────────────
// Fixtures are drawn from the REAL 46-item drawer that motivated this feature, so a
// regression here shows up as the exact pile Mike asked us to get rid of.

function ask(over: Partial<CollapsibleAsk> & { id: string }): CollapsibleAsk {
  return {
    thread_id: `t-${over.id}`,
    from_email: 'someone@example.com',
    subject: 'Subject',
    received_at: '2026-08-03T12:00:00.000Z',
    intent: null,
    ...over,
  };
}

describe('seriesStem', () => {
  it('strips a trailing em-dash date so a daily report collapses to one stem', () => {
    expect(seriesStem('Saiph triage digest — Aug 3')).toBe('saiph triage digest');
    expect(seriesStem('Saiph triage digest — Jul 31')).toBe('saiph triage digest');
  });

  it('strips a trailing ISO date and a trailing year-bearing date', () => {
    expect(seriesStem('Weekly rollup 2026-08-03')).toBe('weekly rollup');
    expect(seriesStem('Weekly rollup - Aug 3, 2026')).toBe('weekly rollup');
  });

  it('strips invoice numbers so two receipts for the same client share a stem', () => {
    expect(seriesStem('Payment received: Invoice #3350-(Vermont Standard)')).toBe(
      seriesStem('Payment received: Invoice #3353-(Vermont Standard)')
    );
  });

  it('does NOT fuse mail that differs by a trailing word — the two Workspace domains stay apart', () => {
    expect(seriesStem('Google Workspace: Your invoice is available for whoismikedion.com')).not.toBe(
      seriesStem('Google Workspace: Your invoice is available for becomeindelible.com')
    );
  });

  it('does not fuse different clients behind the same receipt template', () => {
    expect(seriesStem('Payment received: Invoice #3354-(Bethany Central Church)')).not.toBe(
      seriesStem('Payment received: Invoice #3359-(Griffin Construction)')
    );
  });
});

describe('collapseAsks', () => {
  it('collapses the ow-staff pile: 24 messages become 1 row anchored on the announcement', () => {
    const items = [
      ask({ id: 'a0', thread_id: 'ow', subject: '[ow-staff] NEW HANDBOOK, WHO DIS?', received_at: '2026-08-02T09:00:00.000Z' }),
      ...Array.from({ length: 23 }, (_, i) =>
        ask({
          id: `a${i + 1}`,
          thread_id: 'ow',
          subject: 'Re: [ow-staff] NEW HANDBOOK, WHO DIS?',
          received_at: `2026-08-02T${String(10 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00.000Z`,
        })
      ),
    ];
    const groups = collapseAsks(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('thread');
    expect(groups[0].total).toBe(24);
    expect(groups[0].since).toBe(23);
    // the anchor is the ANNOUNCEMENT, not the newest chatter
    expect(groups[0].anchor.subject).toBe('[ow-staff] NEW HANDBOOK, WHO DIS?');
    expect(groups[0].newest.id).not.toBe(groups[0].anchor.id);
  });

  it('collapses a recurring report across DIFFERENT threads, anchored on the latest instalment', () => {
    const items = ['Jul 31', 'Aug 1', 'Aug 2', 'Aug 3'].map((d, i) =>
      ask({
        id: `s${i}`,
        thread_id: `thread-${i}`, // four separate threads: thread grouping alone does nothing
        from_email: 'bast@becomeindelible.com',
        subject: `Saiph triage digest — ${d}`,
        received_at: `2026-08-0${i + 1}T11:15:00.000Z`,
      })
    );
    const groups = collapseAsks(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('series');
    expect(groups[0].total).toBe(4);
    // a superseded report's signal is the NEWEST one, unlike a conversation
    expect(groups[0].anchor.subject).toBe('Saiph triage digest — Aug 3');
    expect(groups[0].anchor.id).toBe(groups[0].newest.id);
  });

  it('keeps a message inside its conversation rather than also matching it to a series', () => {
    const items = [
      ask({ id: 'c1', thread_id: 'conv', subject: 'Saiph triage digest — Aug 1', received_at: '2026-08-01T10:00:00.000Z', from_email: 'bast@becomeindelible.com' }),
      ask({ id: 'c2', thread_id: 'conv', subject: 'Re: Saiph triage digest — Aug 1', received_at: '2026-08-01T11:00:00.000Z', from_email: 'bast@becomeindelible.com' }),
      ask({ id: 'c3', thread_id: 'other', subject: 'Saiph triage digest — Aug 2', received_at: '2026-08-02T10:00:00.000Z', from_email: 'bast@becomeindelible.com' }),
    ];
    const groups = collapseAsks(items);
    // one thread row + one single — c3 must NOT be pulled into the conversation
    expect(groups.map((g) => g.kind).sort()).toEqual(['single', 'thread']);
    expect(groups.flatMap((g) => g.items).length).toBe(3);
  });

  it('never drops or duplicates a message', () => {
    const items = [
      ask({ id: 'x1', thread_id: 'ow', received_at: '2026-08-01T10:00:00.000Z' }),
      ask({ id: 'x2', thread_id: 'ow', received_at: '2026-08-01T11:00:00.000Z' }),
      ask({ id: 'x3', thread_id: 'solo', subject: 'One off note', received_at: '2026-08-02T10:00:00.000Z' }),
      ask({ id: 'x4', thread_id: 'd1', from_email: 'bast@becomeindelible.com', subject: 'Daily briefing — Aug 1', received_at: '2026-08-01T09:00:00.000Z' }),
      ask({ id: 'x5', thread_id: 'd2', from_email: 'bast@becomeindelible.com', subject: 'Daily briefing — Aug 2', received_at: '2026-08-02T09:00:00.000Z' }),
    ];
    const groups = collapseAsks(items);
    const ids = groups.flatMap((g) => g.items.map((i) => i.id)).sort();
    expect(ids).toEqual(['x1', 'x2', 'x3', 'x4', 'x5']);
  });

  it('orders rows by most recent activity', () => {
    const items = [
      ask({ id: 'old', thread_id: 'o', subject: 'Older thing', received_at: '2026-08-01T09:00:00.000Z' }),
      ask({ id: 'new', thread_id: 'n', subject: 'Newer thing', received_at: '2026-08-03T09:00:00.000Z' }),
    ];
    expect(collapseAsks(items).map((g) => g.anchor.id)).toEqual(['new', 'old']);
  });

  it('carries the anchor lane onto the group', () => {
    const items = [ask({ id: 'm1', thread_id: 'money', subject: 'New Invoice', intent: 'admin' })];
    expect(collapseAsks(items)[0].lane).toBe('admin');
  });

  it('is stable when a whole batch shares one received_at (the classifier stamps them together)', () => {
    const same = '2026-08-03T12:00:00.000Z';
    const items = [
      ask({ id: 'b', thread_id: 'tie', received_at: same }),
      ask({ id: 'a', thread_id: 'tie', received_at: same }),
    ];
    const groups = collapseAsks(items);
    expect(groups[0].anchor.id).toBe('a');
    expect(groups[0].newest.id).toBe('b');
  });

  it('never piles null-thread_id messages into one bogus thread', () => {
    const items = [
      ask({ id: 'n1', thread_id: null, subject: 'Unrelated one', received_at: '2026-08-01T10:00:00.000Z' }),
      ask({ id: 'n2', thread_id: null, subject: 'Unrelated two', received_at: '2026-08-02T10:00:00.000Z' }),
      ask({ id: 'n3', thread_id: null, subject: 'Unrelated three', received_at: '2026-08-03T10:00:00.000Z' }),
    ];
    const groups = collapseAsks(items);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.kind === 'single' && g.total === 1)).toBe(true);
  });

  it('returns nothing for an empty drawer', () => {
    expect(collapseAsks([])).toEqual([]);
  });
});

describe('collapseSummaryLine', () => {
  const tz = 'America/New_York';

  it('reports a thread as messages + replies since + newest', () => {
    const groups = collapseAsks([
      ask({ id: 'p1', thread_id: 'ow', received_at: '2026-08-03T13:00:00.000Z' }),
      ask({ id: 'p2', thread_id: 'ow', received_at: '2026-08-03T18:41:00.000Z' }),
      ask({ id: 'p3', thread_id: 'ow', received_at: '2026-08-03T17:00:00.000Z' }),
    ]);
    expect(collapseSummaryLine(groups[0], tz)).toBe('3 messages · 2 replies since · newest 2:41 PM');
  });

  it('singularises a lone reply', () => {
    const groups = collapseAsks([
      ask({ id: 'q1', thread_id: 'ow', received_at: '2026-08-03T13:00:00.000Z' }),
      ask({ id: 'q2', thread_id: 'ow', received_at: '2026-08-03T18:41:00.000Z' }),
    ]);
    expect(collapseSummaryLine(groups[0], tz)).toBe('2 messages · 1 reply since · newest 2:41 PM');
  });

  it('reports a series as a report count', () => {
    const groups = collapseAsks([
      ask({ id: 'r1', thread_id: 'd1', from_email: 'bast@becomeindelible.com', subject: 'Saiph triage digest — Aug 2', received_at: '2026-08-02T11:15:00.000Z' }),
      ask({ id: 'r2', thread_id: 'd2', from_email: 'bast@becomeindelible.com', subject: 'Saiph triage digest — Aug 3', received_at: '2026-08-03T15:15:00.000Z' }),
    ]);
    expect(collapseSummaryLine(groups[0], tz)).toBe('2 reports · newest 11:15 AM');
  });

  it('reports a single as just its time', () => {
    const groups = collapseAsks([ask({ id: 'z1', thread_id: 'solo', subject: 'A one-off note', received_at: '2026-08-03T18:41:00.000Z' })]);
    expect(collapseSummaryLine(groups[0], tz)).toBe('newest 2:41 PM');
  });
});
