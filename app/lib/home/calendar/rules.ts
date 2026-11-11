/**
 * Home screen Slice 10a: the numbers and lists behind today's calendar strip and the meeting
 * drawer. Plain data, no I/O.
 */

/** The one calendar the sync reads (calendar-sync.py CALENDAR_ID). Only this user may see the strip. */
export const CALENDAR_OWNER_EMAIL = 'mike@becomeindelible.com';

/** Hosts whose links count as a meeting link. A host matches when it equals the entry or ends with "." plus the entry. */
export const MEETING_HOSTS: readonly string[] = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'whereby.com',
];

export const CAL = {
  /** Upcoming timed rows shown before "N more later today". */
  upcoming: 4,
  /** The tomorrow line shows from this hour (24h) in his zone. */
  tomorrowHour: 15,
  /** A meeting under way, or starting within this many minutes, shows above a pinned card. */
  soonMinutes: 30,
  /** A block longer than this reads "until 6:00". */
  longBlockMinutes: 90,
  /** Characters of the invite text in the drawer. */
  inviteChars: 600,
  items: 3,
  hints: 3,
  links: 6,
  /** Shortest name that may match a meeting title. */
  titleMin: 4,
  /** Meeting links shown under the invite text. */
  inviteLinks: 3,
  /** Rows in the chat shape. */
  chatRows: 12,
  /** Report-type links from project resources. */
  reportLinks: 2,
  /** Days a done project still lends its report links. */
  reportDoneDays: 180,
} as const;

/** Words that never match a meeting title to a project or client. Lowercase. */
export const TITLE_STOPLIST: readonly string[] = ['home', 'call', 'meeting', 'lunch', 'indelible'];

/** Resource link names that count as a report. */
export const REPORT_NAME_PATTERN = /report|audit|intel|intelligence|microsite|strategy|roadmap|swot|proposal|growth plan/i;

/** Project statuses that count as live. */
export const LIVE_PROJECT_STATUSES = ['ready', 'in_progress', 'review'] as const;

/** Lead statuses that match an attendee as a lead. */
export const LEAD_ACCORD_STATUSES = ['lead', 'meeting', 'proposal', 'contract'] as const;
