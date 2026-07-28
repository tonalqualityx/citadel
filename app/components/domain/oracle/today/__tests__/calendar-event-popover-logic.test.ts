import { describe, it, expect } from 'vitest';
import {
  linkifySegments,
  attendeeResponseLabel,
  joinUrl,
  formatMeetingRange,
  attendeeSummary,
} from '../calendar-event-popover-logic';

describe('linkifySegments', () => {
  it('returns a single text segment when there is no URL', () => {
    expect(linkifySegments('Quarterly review, bring numbers')).toEqual([
      { kind: 'text', value: 'Quarterly review, bring numbers' },
    ]);
  });

  it('returns an empty array for empty text', () => {
    expect(linkifySegments('')).toEqual([]);
  });

  it('splits text around a bare URL into text/link/text', () => {
    const segments = linkifySegments('Agenda: https://docs.example.com/agenda see you there');
    expect(segments).toEqual([
      { kind: 'text', value: 'Agenda: ' },
      { kind: 'link', value: 'https://docs.example.com/agenda' },
      { kind: 'text', value: ' see you there' },
    ]);
  });

  it('handles a URL at the very start or end with no surrounding text segment', () => {
    expect(linkifySegments('https://a.com')).toEqual([{ kind: 'link', value: 'https://a.com' }]);
  });

  it('handles multiple URLs', () => {
    const segments = linkifySegments('https://a.com and https://b.com');
    expect(segments.filter((s) => s.kind === 'link')).toHaveLength(2);
  });

  it('never interprets HTML tags as anything other than literal text (no innerHTML path exists)', () => {
    const segments = linkifySegments('<script>alert(1)</script> https://safe.com');
    expect(segments[0]).toEqual({ kind: 'text', value: '<script>alert(1)</script> ' });
  });
});

describe('attendeeResponseLabel', () => {
  it('maps known Google values', () => {
    expect(attendeeResponseLabel('accepted')).toBe('accepted');
    expect(attendeeResponseLabel('declined')).toBe('declined');
    expect(attendeeResponseLabel('tentative')).toBe('tentative');
  });

  it('falls back to "no reply" for needsAction, null, undefined, or an unrecognized future value', () => {
    expect(attendeeResponseLabel('needsAction')).toBe('no reply');
    expect(attendeeResponseLabel(null)).toBe('no reply');
    expect(attendeeResponseLabel(undefined)).toBe('no reply');
    expect(attendeeResponseLabel('some_future_google_status')).toBe('no reply');
  });
});

describe('joinUrl', () => {
  it('returns the URL when it is a real https link', () => {
    expect(joinUrl({ meet_url: 'https://meet.google.com/abc-defg-hij' })).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('returns null when meet_url is null', () => {
    expect(joinUrl({ meet_url: null })).toBeNull();
  });

  it('rejects a non-https value (never renders a dead-looking Join button)', () => {
    expect(joinUrl({ meet_url: 'http://insecure.example.com/room' })).toBeNull();
    expect(joinUrl({ meet_url: 'not-a-url' })).toBeNull();
    expect(joinUrl({ meet_url: '' })).toBeNull();
  });
});

describe('formatMeetingRange', () => {
  it('formats a 30-minute meeting with an explicit timezone', () => {
    const label = formatMeetingRange('2026-07-21T18:00:00.000Z', '2026-07-21T18:30:00.000Z', 'America/New_York');
    expect(label).toBe('2:00 – 2:30 PM · 30 min');
  });

  it('keeps both AM/PM markers when the meeting straddles noon', () => {
    // 11:45 AM - 12:15 PM ET (EDT = UTC-4)
    const label = formatMeetingRange('2026-07-21T15:45:00.000Z', '2026-07-21T16:15:00.000Z', 'America/New_York');
    expect(label).toBe('11:45 AM – 12:15 PM · 30 min');
  });

  it('never uses the implicit browser locale — an explicit IANA zone always changes the output', () => {
    const et = formatMeetingRange('2026-07-21T18:00:00.000Z', '2026-07-21T19:00:00.000Z', 'America/New_York');
    const karachi = formatMeetingRange('2026-07-21T18:00:00.000Z', '2026-07-21T19:00:00.000Z', 'Asia/Karachi');
    expect(et).not.toBe(karachi);
  });
});

describe('attendeeSummary', () => {
  it('counts each response bucket, folding needsAction/unknown into pending', () => {
    const summary = attendeeSummary([
      { email: 'a@x.com', display_name: null, response_status: 'accepted' },
      { email: 'b@x.com', display_name: null, response_status: 'declined' },
      { email: 'c@x.com', display_name: null, response_status: 'tentative' },
      { email: 'd@x.com', display_name: null, response_status: 'needsAction' },
      { email: 'e@x.com', display_name: null, response_status: null },
    ]);
    expect(summary).toEqual({ accepted: 1, declined: 1, tentative: 1, pending: 2, total: 5 });
  });

  it('returns all zeros for null/undefined/empty attendees', () => {
    expect(attendeeSummary(null)).toEqual({ accepted: 0, declined: 0, tentative: 0, pending: 0, total: 0 });
    expect(attendeeSummary(undefined)).toEqual({ accepted: 0, declined: 0, tentative: 0, pending: 0, total: 0 });
    expect(attendeeSummary([])).toEqual({ accepted: 0, declined: 0, tentative: 0, pending: 0, total: 0 });
  });
});
