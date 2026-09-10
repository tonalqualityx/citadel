import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PUBLISH_PER_WEEK,
  RUNWAY_BUFFER_DAYS,
  computeSiteRunway,
  isRecentlyActive,
  renderMeetingRequestDraft,
  utcDateString,
} from '../runway';

const NOW = new Date('2026-09-10T12:00:00Z');
const site = { id: 'site-1', name: 'botanicaldream.com' };
const client = { id: 'client-1', name: 'Herba' };

function compute(articles: Array<Record<string, unknown>>, cadence?: Record<string, unknown> | null) {
  return computeSiteRunway({
    site,
    client,
    articles: articles as never,
    cadence: cadence as never,
    now: NOW,
  });
}

describe('computeSiteRunway — the shelf', () => {
  it('reports zero runway and raises the alarm when the shelf is empty', () => {
    // Botanical Dream's actual state: everything published or postponed, nothing left to publish.
    const r = compute([
      { status: 'published', published_url: 'https://x/1', scheduled_date: '2026-09-07' },
      { status: 'postponed', scheduled_date: null },
      { status: 'postponed', scheduled_date: null },
    ]);
    expect(r.shelf_count).toBe(0);
    expect(r.postponed_count).toBe(2);
    expect(r.runway_days).toBe(0);
    expect(r.runway_end).toBe('2026-09-10');
    expect(r.low_runway).toBe(true);
  });

  it('does not raise the alarm when the shelf outlasts the trigger window', () => {
    const articles = Array.from({ length: 10 }, (_, i) => ({
      status: 'scheduled',
      scheduled_date: `2026-09-${String(11 + i).padStart(2, '0')}`,
      published_url: null,
    }));
    const r = compute(articles, { publish_per_week: 2, lead_time_days: 7 });
    expect(r.shelf_count).toBe(10);
    expect(r.runway_days).toBe(35);
    expect(r.trigger_days).toBe(14);
    expect(r.low_runway).toBe(false);
  });

  it('never counts published, postponed, dropped or still-being-written copy as shelf', () => {
    const r = compute([
      { status: 'published', published_url: 'https://x/1' },
      { status: 'postponed' },
      { status: 'dropped' },
      { status: 'drafting' },
      { status: 'in_review' },
      { status: 'needs_revision' },
      { status: 'pending_research' },
      { status: 'researched' },
    ]);
    expect(r.shelf_count).toBe(0);
  });

  it('treats an approved article that carries a published_url as already gone', () => {
    const r = compute([{ status: 'approved', published_url: 'https://x/1' }]);
    expect(r.shelf_count).toBe(0);
  });

  it('counts dateless approved copy as shelf but flags that it cannot publish itself', () => {
    // The publish driver only dispatches articles with a scheduled_date, so a stocked
    // shelf of dateless articles is not the same as a healthy pipeline.
    const r = compute([
      { status: 'approved', scheduled_date: null, published_url: null },
      { status: 'approved', scheduled_date: null, published_url: null },
      { status: 'scheduled', scheduled_date: '2026-09-20', published_url: null },
    ]);
    expect(r.shelf_count).toBe(3);
    expect(r.unscheduled_count).toBe(2);
    expect(r.scheduled_through).toBe('2026-09-20');
  });

  it('reports scheduled_through as null when nothing on the shelf carries a date', () => {
    const r = compute([{ status: 'approved', scheduled_date: null, published_url: null }]);
    expect(r.scheduled_through).toBeNull();
  });
});

describe('computeSiteRunway — cadence', () => {
  it('falls back to the default cadence and says so when no schedule exists', () => {
    const r = compute([{ status: 'approved', published_url: null }], null);
    expect(r.publish_per_week).toBe(DEFAULT_PUBLISH_PER_WEEK);
    expect(r.cadence_source).toBe('default');
    expect(r.lead_time_days).toBe(7);
    expect(r.trigger_days).toBe(7 + RUNWAY_BUFFER_DAYS);
  });

  it('uses the site schedule cadence when there is one', () => {
    const r = compute(
      Array.from({ length: 4 }, () => ({ status: 'approved', published_url: null })),
      { publish_per_week: 1, lead_time_days: 14 },
    );
    expect(r.cadence_source).toBe('schedule');
    expect(r.publish_per_week).toBe(1);
    expect(r.runway_days).toBe(28);
    expect(r.trigger_days).toBe(21);
    expect(r.low_runway).toBe(false);
  });

  it('ignores a zero or null cadence rather than dividing by it', () => {
    const zero = compute([{ status: 'approved', published_url: null }], { publish_per_week: 0, lead_time_days: 7 });
    expect(zero.publish_per_week).toBe(DEFAULT_PUBLISH_PER_WEEK);
    expect(zero.cadence_source).toBe('default');
    expect(Number.isFinite(zero.runway_days)).toBe(true);

    const nulled = compute([{ status: 'approved', published_url: null }], { publish_per_week: null, lead_time_days: 7 });
    expect(nulled.publish_per_week).toBe(DEFAULT_PUBLISH_PER_WEEK);
  });

  it('caps a runaway projection rather than producing an out-of-range date', () => {
    // An absurd shelf must not throw: this runs on every worker tick.
    const r = compute(
      Array.from({ length: 200000 }, () => ({ status: 'approved', published_url: null })),
      { publish_per_week: 0.01, lead_time_days: 7 },
    );
    expect(r.runway_days).toBe(3650);
    expect(r.runway_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('handles a fractional cadence', () => {
    const r = compute(
      Array.from({ length: 3 }, () => ({ status: 'approved', published_url: null })),
      { publish_per_week: 0.5, lead_time_days: 7 },
    );
    expect(r.runway_days).toBe(42);
  });
});

describe('renderMeetingRequestDraft', () => {
  const dry = compute([], { publish_per_week: 1, lead_time_days: 14 });

  it('fills every slot and leaves no unreplaced placeholder', () => {
    const draft = renderMeetingRequestDraft(dry, { contactFirstName: 'Dan', now: NOW });
    const all = `${draft.to_client.subject}\n${draft.to_client.body}\n${draft.to_mike}`;
    expect(all).not.toMatch(/[{}]/);
    expect(all).not.toMatch(/undefined|NaN|null/);
    expect(draft.to_client.body).toContain('Hi Dan,');
    expect(draft.to_client.subject).toContain('Herba');
    expect(draft.to_client.body).toContain('botanicaldream.com');
    expect(draft.booking_url).toMatch(/^https:\/\//);
  });

  it('backs the booking date off by the lead time so copy lands before the shelf empties', () => {
    const stocked = compute(
      Array.from({ length: 4 }, () => ({ status: 'approved', published_url: null })),
      { publish_per_week: 1, lead_time_days: 14 },
    );
    expect(stocked.runway_end).toBe('2026-10-08');
    const draft = renderMeetingRequestDraft(stocked, { now: NOW });
    expect(draft.book_by_date).toBe('2026-09-24');
    expect(draft.to_client.body).toContain('keeps the publishing schedule intact');
  });

  it('never tells a client to book by a date that has already passed', () => {
    // The shelf is empty, so backing off by the lead time lands two weeks ago. A note saying
    // "book by [a date in the past]" reads as a mistake to whoever opens it.
    expect(dry.runway_end).toBe('2026-09-10');
    const draft = renderMeetingRequestDraft(dry, { now: NOW });
    expect(draft.book_by_date).toBe('2026-09-10');
    expect(draft.book_by_date >= '2026-09-10').toBe(true);
  });

  it('admits the gap instead of promising the schedule stays intact when it cannot', () => {
    const draft = renderMeetingRequestDraft(dry, { now: NOW });
    expect(draft.to_client.body).toContain('There will be a gap.');
    expect(draft.to_client.body).not.toContain('keeps the publishing schedule intact');
  });

  it('never breaks a sentence across two lines', () => {
    // Mike pastes this into an email. A hard wrap mid-clause reads as a formatting error.
    for (const r of [dry, compute([{ status: 'approved', published_url: null }], { publish_per_week: 0.5, lead_time_days: 7 })]) {
      const lines = renderMeetingRequestDraft(r, { now: NOW }).to_client.body.split('\n');
      for (const [i, line] of lines.entries()) {
        const next = lines[i + 1];
        if (!line.trim() || !next?.trim()) continue;
        expect(line.trimEnd().endsWith('.') || line.trimEnd().endsWith(',')).toBe(true);
      }
    }
  });

  it('addresses the client neutrally when no contact name is known', () => {
    const draft = renderMeetingRequestDraft(dry, { contactFirstName: null, now: NOW });
    expect(draft.to_client.body).toContain('Hi there,');
  });

  it("tells Mike about dateless copy and the postponed backlog he could revive", () => {
    const stocked = compute(
      [
        { status: 'approved', scheduled_date: null, published_url: null },
        { status: 'postponed' },
      ],
      { publish_per_week: 4, lead_time_days: 7 },
    );
    const draft = renderMeetingRequestDraft(stocked, { now: NOW });
    expect(draft.to_mike).toContain('1 approved article');
    expect(draft.to_mike).toContain('no publish date');
    expect(draft.to_mike).toContain('1 postponed');
  });

  it('omits the dateless and backlog sentences when neither applies', () => {
    const clean = compute(
      [{ status: 'scheduled', scheduled_date: '2026-09-12', published_url: null }],
      { publish_per_week: 4, lead_time_days: 7 },
    );
    const draft = renderMeetingRequestDraft(clean, { now: NOW });
    expect(draft.to_mike).not.toContain('no publish date');
    expect(draft.to_mike).not.toContain('postponed');
  });
});

describe('isRecentlyActive', () => {
  it('counts a site that published in the last 90 days', () => {
    expect(isRecentlyActive('2026-09-07', NOW)).toBe(true);
  });

  it('ages off a site that stopped publishing long ago', () => {
    expect(isRecentlyActive('2026-01-01', NOW)).toBe(false);
  });

  it('treats a missing or unparseable date as not active', () => {
    expect(isRecentlyActive(null, NOW)).toBe(false);
    expect(isRecentlyActive('not-a-date', NOW)).toBe(false);
  });
});

describe('utcDateString', () => {
  it('uses UTC calendar fields, not local ones', () => {
    expect(utcDateString(new Date('2026-09-10T23:59:59Z'))).toBe('2026-09-10');
  });
});
