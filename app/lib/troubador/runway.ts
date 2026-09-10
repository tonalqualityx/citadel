// Content runway: how many days of publishable content a site still has on the shelf.
//
// A site "runs dry" quietly. Its last run reaches `done`, the work queue only scans runs in
// live stages, and so the site simply stops appearing anywhere — which is exactly how
// Botanical Dream got to zero approved-unpublished articles without anything raising a hand.
// The arithmetic here is deliberately dumb (counts, a cadence and a division) and lives apart
// from Prisma so it can be tested directly. No model is ever involved, in the computation or
// in the meeting-request wording.

// Cadence fallback when a site has no active schedule. Mirrors the TroubadorSchedule
// `publish_per_week` / `lead_time_days` schema defaults, so a scheduleless site is measured
// against the same yardstick a freshly created schedule would give it.
export const DEFAULT_PUBLISH_PER_WEEK = 2;
export const DEFAULT_LEAD_TIME_DAYS = 7;

// Days of slack on top of lead time. Content ordered on the day the shelf empties is already
// late by a lead time; the buffer is what makes the alarm early enough to act on.
export const RUNWAY_BUFFER_DAYS = 7;

// A site that published nothing in this long is treated as no longer under Troubador, so a
// finished engagement ages off the alarm instead of nagging forever.
export const RECENTLY_ACTIVE_DAYS = 90;

// The tag the alarm's follow-up task carries. Once an open task for a site wears it, the alarm
// has already been raised and the queue stops re-emitting it — otherwise the worker would refile
// the same ask every tick for as long as the site stayed dry.
export const RUNWAY_TASK_TAG = 'content-runway';

// Task statuses that mean the alarm's follow-up is still open.
export const OPEN_TASK_STATUSES = ['not_started', 'in_progress', 'review', 'blocked'] as const;

// Where the client books the content meeting. Mirrors `booking_url` in
// ~/.openclaw/workspace/pipeline/router/config/retainers.json — one booking link, two systems.
export const MEETING_BOOKING_URL = 'https://calendly.com/indelible-mike/marketing-meeting';

const DAY_MS = 24 * 60 * 60 * 1000;

// Ceiling on the projected runway. Only reachable by an absurd shelf, but the work queue calls
// this on every worker tick and an out-of-range Date would throw on toISOString() and take the
// whole queue down. Ten years reads the same as "not a problem" and cannot overflow.
const MAX_RUNWAY_DAYS = 3650;

// Articles that are written, approved and simply waiting for their publish slot.
export const SHELF_STATUSES = ['approved', 'scheduled'] as const;

// Run stages that mean a content cycle is still in flight for the site.
export const LIVE_RUN_STAGES = [
  'planning',
  'topic_selection',
  'researching',
  'ready_for_interview',
  'in_production',
  'publishing',
] as const;

export interface RunwayArticle {
  status: string;
  scheduled_date?: Date | string | null;
  published_url?: string | null;
}

export interface RunwayCadence {
  publish_per_week?: number | null;
  lead_time_days?: number | null;
}

export interface SiteRunway {
  site_id: string;
  site_name: string;
  client_id: string;
  client_name: string;
  /** Approved/scheduled articles with no published_url — the publishable shelf. */
  shelf_count: number;
  /** Of the shelf, how many carry no scheduled_date. The publish driver only dispatches
   *  dated articles, so these are on the shelf but cannot leave it unaided. */
  unscheduled_count: number;
  /** Parked articles. Not runway, but a re-evaluation can pull them back. */
  postponed_count: number;
  publish_per_week: number;
  cadence_source: 'schedule' | 'default';
  lead_time_days: number;
  runway_days: number;
  /** The day the shelf empties at the current cadence, as a UTC calendar date. */
  runway_end: string;
  /** Furthest future scheduled_date on the shelf, or null. Independent of cadence. */
  scheduled_through: string | null;
  trigger_days: number;
  low_runway: boolean;
  has_live_run: boolean;
  /** An open task already carries this site's runway ask, so the alarm has been raised. */
  has_open_alarm_task: boolean;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC calendar day of a date, as YYYY-MM-DD. Locale-independent, matching the rest of Troubador. */
export function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface ComputeSiteRunwayInput {
  site: { id: string; name: string };
  client: { id: string; name: string };
  articles: RunwayArticle[];
  cadence?: RunwayCadence | null;
  hasLiveRun?: boolean;
  hasOpenAlarmTask?: boolean;
  now?: Date;
}

/**
 * Per-site runway from the shelf and the publish cadence.
 *
 * Shelf = approved|scheduled with no published_url. `published`, `postponed`, `dropped` and
 * everything still being written are not runway: only finished, approved copy is.
 */
export function computeSiteRunway(input: ComputeSiteRunwayInput): SiteRunway {
  const now = input.now ?? new Date();
  const shelfStatuses = new Set<string>(SHELF_STATUSES);

  let shelfCount = 0;
  let unscheduledCount = 0;
  let postponedCount = 0;
  let furthest: Date | null = null;

  for (const a of input.articles) {
    if (a.status === 'postponed') {
      postponedCount++;
      continue;
    }
    if (!shelfStatuses.has(a.status)) continue;
    if (a.published_url) continue;

    shelfCount++;
    const scheduled = toDate(a.scheduled_date);
    if (!scheduled) {
      unscheduledCount++;
      continue;
    }
    if (!furthest || scheduled > furthest) furthest = scheduled;
  }

  const rawPerWeek = input.cadence?.publish_per_week;
  const hasCadence = rawPerWeek != null && Number(rawPerWeek) > 0;
  const publishPerWeek = hasCadence ? Number(rawPerWeek) : DEFAULT_PUBLISH_PER_WEEK;
  const leadTimeDays = input.cadence?.lead_time_days ?? DEFAULT_LEAD_TIME_DAYS;

  const runwayDays = Math.min(Math.floor((shelfCount / publishPerWeek) * 7), MAX_RUNWAY_DAYS);
  const triggerDays = leadTimeDays + RUNWAY_BUFFER_DAYS;

  return {
    site_id: input.site.id,
    site_name: input.site.name,
    client_id: input.client.id,
    client_name: input.client.name,
    shelf_count: shelfCount,
    unscheduled_count: unscheduledCount,
    postponed_count: postponedCount,
    publish_per_week: publishPerWeek,
    cadence_source: hasCadence ? 'schedule' : 'default',
    lead_time_days: leadTimeDays,
    runway_days: runwayDays,
    runway_end: utcDateString(new Date(now.getTime() + runwayDays * DAY_MS)),
    scheduled_through: furthest ? utcDateString(furthest) : null,
    trigger_days: triggerDays,
    low_runway: runwayDays <= triggerDays,
    has_live_run: input.hasLiveRun ?? false,
    has_open_alarm_task: input.hasOpenAlarmTask ?? false,
  };
}

export interface MeetingRequestDraft {
  to_client: { subject: string; body: string };
  to_mike: string;
  booking_url: string;
  book_by_date: string;
}

/**
 * The meeting request, rendered from fixed wording — never composed by a model, and never
 * sent from here. Client outreach is draft-only: this returns text for a human to approve.
 * The client-facing half mirrors router/config/templates/runway-nudge.txt verbatim in
 * structure so the two systems speak with one voice.
 */
export function renderMeetingRequestDraft(
  runway: SiteRunway,
  opts: { contactFirstName?: string | null; bookingUrl?: string; now?: Date } = {},
): MeetingRequestDraft {
  const today = utcDateString(opts.now ?? new Date());
  const bookingUrl = opts.bookingUrl || MEETING_BOOKING_URL;
  const firstName = opts.contactFirstName?.trim() || 'there';

  // Book far enough ahead that copy from the meeting lands before the shelf empties. Once the
  // shelf is closer than a lead time away that date is already behind us, and a note telling a
  // client to book by a date in the past reads as a mistake — so the date floors at today and
  // the sentence changes to admit the gap instead of promising there will not be one.
  const idealBookBy = utcDateString(
    new Date(new Date(`${runway.runway_end}T00:00:00Z`).getTime() - runway.lead_time_days * DAY_MS),
  );
  const alreadyLate = idealBookBy < today;
  const bookBy = alreadyLate ? today : idealBookBy;

  const timing = alreadyLate
    ? [
        `The schedule for ${runway.site_name} runs out on ${runway.runway_end}, and articles need`,
        `about ${runway.lead_time_days} days to go from conversation to published post, so there`,
        'will be a gap. Booking this week keeps it short.',
      ]
    : [
        `Booking by ${bookBy} keeps the publishing schedule intact. Articles from that call need`,
        `about ${runway.lead_time_days} days to move from conversation to published post, and the`,
        `current schedule for ${runway.site_name} runs out on ${runway.runway_end}.`,
      ];

  const body = [
    `Hi ${firstName},`,
    '',
    `It is time to put the next content meeting for ${runway.client_name} on the calendar.`,
    '',
    ...timing,
    '',
    `Pick a time here: ${bookingUrl}`,
    '',
    'If nothing on that calendar works, reply to this email and we will find a slot.',
    '',
    'Indelible',
  ].join('\n');

  const shelf =
    runway.shelf_count === 1 ? '1 approved article' : `${runway.shelf_count} approved articles`;

  const toMike = [
    `${runway.site_name} has ${shelf} left, which is ${runway.runway_days} days at ${runway.publish_per_week} posts per week.`,
    runway.unscheduled_count > 0
      ? `${runway.unscheduled_count} of them have no publish date, so they cannot go out on their own.`
      : null,
    runway.postponed_count > 0
      ? `${runway.postponed_count} postponed articles could be revived instead of writing new ones.`
      : null,
    `Approve the note below and it goes to the client, or book the meeting yourself: ${bookingUrl}`,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    to_client: {
      subject: `Booking the next content meeting for ${runway.client_name}`,
      body,
    },
    to_mike: toMike,
    booking_url: bookingUrl,
    book_by_date: bookBy,
  };
}

/** Was this site publishing recently enough to still be considered under Troubador? */
export function isRecentlyActive(lastPublishedAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  const d = toDate(lastPublishedAt);
  if (!d) return false;
  return now.getTime() - d.getTime() <= RECENTLY_ACTIVE_DAYS * DAY_MS;
}
