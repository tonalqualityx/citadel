/**
 * Home screen Slice 1: the named constants of plan section 1.3 and the pure emergency
 * predicates. Server and client may both import this file; it has no I/O and no Prisma.
 *
 * Every number here is internal. None of them, and nothing derived from them (importance,
 * urgency, consequence class, emergency rule), is ever sent to the browser or shown. The
 * response shape in ./types.ts has no field for any of it.
 *
 * Tuning: a later slice changes a constant here, never a caller. score.ts, select.ts and
 * today.ts (H4) read these by name.
 *
 * Time zone: the business-day helpers count Monday to Friday in America/New_York with no
 * holiday calendar, the same clock as lib/waits/business-days.ts, whose primitives they use.
 * Mike's zone is New York, so Slice 1 does not thread the user's zone through here.
 */

import type { AskSeverity, EmailAskState } from '@prisma/client';
import { DUE_HOUR, addBusinessDays, zonedParts } from '@/lib/waits/business-days';

// ============================================================================
// Sources (plan 1.1)
// ============================================================================

/** Task statuses that are never on the plate. `triage` is an idea parked for Mike's release: not work until then. */
export const CLOSED_TASK_STATUSES = ['done', 'abandoned', 'triage'] as const;

/** A task whose project has one of these statuses is not an item (plan 1.1). */
export const EXCLUDED_PROJECT_STATUSES = ['quote', 'queue', 'suspended', 'cancelled', 'done'] as const;

/**
 * The subset of EXCLUDED_PROJECT_STATUSES that Everything else still counts, as "on paused or
 * unsigned projects" (quote and queue are unsigned, suspended is paused). Tasks on cancelled
 * or done projects are not counted anywhere.
 */
export const HELD_PROJECT_STATUSES = ['quote', 'queue', 'suspended'] as const;

/** Session statuses that never carry an ask. */
export const EXCLUDED_SESSION_STATUSES = ['ended', 'stale'] as const;

/** Wait states the loader reads (same list as OPEN_FOR_BLOCKS in lib/waits/load-blocks.ts). */
export const OPEN_WAIT_STATES = ['waiting', 'needs_human', 'blocked_by_switch'] as const;

/** A wait in this state is in view at once; any other open wait only once due_at has passed. */
export const WAIT_IN_VIEW_STATE = 'needs_human';

/** Wait template whose approval needs approved_terms, so it gets "Open" only (plan 1.4). */
export const PRICE_REVIEW_WAIT_TEMPLATE = 'charter.price_review';

/** EmailAsk.training_note prefix the classifier writes when it closes an ask on its own. */
export const AUTO_HANDLED_NOTE_PREFIX = '[auto] ';

// ============================================================================
// Tags (plan 1.3, emergency rules and importance)
// ============================================================================

export const SECURITY_TAGS = ['security', 'security-report'] as const;
export const LIFELINE_TAG = 'lifeline';
/** Any tag that starts with this counts as a lifeline (job-watch, job-watch:claude-signin). */
export const JOB_WATCH_TAG_PREFIX = 'job-watch';
export const CLIENT_BLOCKING_TAG = 'client-blocking';

// ============================================================================
// Who is a person (plan 1.3)
// ============================================================================

/** Mike's and Indelible's own addresses: never a person waiting. Compared lowercased. */
export const OWN_ADDRESSES = [
  'mike@becomeindelible.com',
  'mike@whoismikedion.com',
  'support@becomeindelible.com',
  'bast@becomeindelible.com',
  'hello@becomeindelible.com',
] as const;

/** Ruled noise by sender domain. A subdomain of one of these is noise too. */
export const NOISE_SENDER_DOMAINS = ['collectiveyouth.com', 'wol.org'] as const;

/**
 * Ruled noise by client name, matched as whole words, case-insensitive. Their sender domains
 * are not verified, so Slice 1 matches these by client name only.
 */
export const NOISE_CLIENT_NAMES = ['Balloon Guild', 'Cygal', 'Word of Life'] as const;

/**
 * An address containing any of these (case-insensitive, anywhere in the address, so both the
 * local part and the domain are covered) is an automated sender.
 */
export const AUTOMATED_SENDER_PATTERNS = [
  'no-reply',
  'noreply',
  'notification',
  'servers@',
  'uptime',
  'drive-shares',
  'mailer-daemon',
  'calendar',
  'wordpress@',
  'wpmudev',
] as const;

/** Calendar replies and invitations: a subject starting with one of these never qualifies. */
export const CALENDAR_SUBJECT_PREFIXES = [
  'Accepted:',
  'Declined:',
  'Invitation:',
  'Updated invitation',
  'Tentative',
] as const;

/**
 * Other ventures, matched as whole words, case-insensitive, against the client name or the
 * project name. Not verified against live client names (the verifier checks them, plan 7).
 */
export const VENTURE_NAMES = ['Saiph', 'KNT', 'Kava News', 'Zorp', 'Schoolhouse'] as const;

// ============================================================================
// Caps and windows
// ============================================================================

export const CAPS = {
  /** Today, "Quick, before you start". */
  quick: 3,
  /** Client emails waiting, visible rows. A lead never counts against it. */
  mail: 3,
  /** Next (decisions ready), visible rows. */
  next: 3,
  /** Today's arc, open steps the system proposes. Steps Mike added never count. */
  arcSteps: 4,
  /** Handled for you, visible lines before the "{n} more handled" line. */
  handled: 5,
  /** Buttons shown on a row or card; the rest go under More. */
  visibleActions: 3,
  /** Working on: pinned items at once. */
  pinned: 1,
} as const;

/** A thread whose newest open ask is older than this many calendar days counts as an older open thread. */
export const THREAD_MAX_AGE_DAYS = 21;
/** A non-sales thread must be at least this many business days old to show (sales: any age). */
export const THREAD_MIN_AGE_BUSINESS_DAYS = 1;
/** Handled for you looks back this far. */
export const HANDLED_WINDOW_HOURS = 24;
/** A thread with a message this recent gets the fresh-activity bonus. */
export const FRESH_ACTIVITY_HOURS = 24;
/** Card summary length (plain-text.ts truncates to this on a word boundary). */
export const CARD_SUMMARY_MAX_WORDS = 60;

// ============================================================================
// Emergency thresholds (plan 1.3, rules 4 and 7)
// ============================================================================

/** Rule 4: a client-blocking wait is an emergency once this many business days have elapsed. */
export const CLIENT_WAIT_EMERGENCY_BUSINESS_DAYS = 1;
/** Rule 7: a promised hard date this many business days away or less (or past) is an emergency. */
export const PROMISED_DATE_EMERGENCY_BUSINESS_DAYS = 2;

// ============================================================================
// Importance, 0 to 100 (plan 1.3). Internal only.
// ============================================================================

export const IMPORTANCE = {
  base: 10,
  max: 100,
  clientTrust: {
    /** Item belongs to an active client. */
    activeClient: 30,
    /** promised_to set, wait blocks_client, or session ask client_blocking or launch_blocking. */
    promise: 15,
    /** requested_by_contact_id set, client_visible true, or an open EmailAsk linked by task_id. */
    contact: 10,
    cap: 45,
  },
  money: {
    /** Tags security, security-report, lifeline or job-watch*. */
    tags: 25,
    /** charter_id, accord_id or billing_amount > 0. */
    link: 15,
    /** site_id set. */
    site: 10,
    cap: 25,
  },
  unblocks: {
    /** Per open task in the task's blocking list. */
    perBlockedTask: 7,
    blockedTaskCap: 14,
    /** Review sign-off: base plus 1 per this many pieces. */
    reviewBase: 6,
    reviewPiecesPerPoint: 5,
    /** A session ask: an agent is waiting. */
    session: 10,
    cap: 20,
  },
  /** Other ventures are capped at this total. */
  ventureCap: 20,
} as const;

// ============================================================================
// Consequence class, 1 to 4 (plan 1.3). Internal only.
// ============================================================================

export const CONSEQUENCE = {
  /** Class 1 when the client-trust part is at least this. */
  class1MinClientTrust: 30,
  /** Class 2 when the money part is at least this ... */
  class2MinMoney: 15,
  /** ... or a hard date is this many calendar days away or less. */
  class2HardDateDays: 7,
  /** Class 3 when the unblocks part is above 0; class 4 otherwise. */
} as const;

// ============================================================================
// Urgency, 0 to 100 (plan 1.3). Internal only. Highest that applies wins.
// ============================================================================

export const URGENCY = {
  hardDate: {
    past: 100,
    /** First entry whose maxBusinessDays is at least the business days left wins. */
    steps: [
      { maxBusinessDays: 2, urgency: 90 },
      { maxBusinessDays: 5, urgency: 70 },
      { maxBusinessDays: 10, urgency: 50 },
    ],
    beyond: 20,
  },
  /**
   * A person waiting, by business days since the wait began. First entry whose
   * minBusinessDays is at most the elapsed count wins, so the list runs high to low.
   */
  waiting: [
    { minBusinessDays: 20, urgency: 90 },
    { minBusinessDays: 10, urgency: 80 },
    { minBusinessDays: 5, urgency: 65 },
    { minBusinessDays: 3, urgency: 50 },
    { minBusinessDays: 1, urgency: 30 },
    { minBusinessDays: 0, urgency: 10 },
  ],
  /** Added when a thread has a message in the last FRESH_ACTIVITY_HOURS. */
  freshBonus: 10,
  /** Anything else. */
  other: 10,
  max: 100,
} as const;

// ============================================================================
// Next (decisions ready, plan 1.3). Internal only.
// ============================================================================

export const NEXT_ENTRY = {
  /** Class 1 enters Next at this urgency or more. */
  class1MinUrgency: 30,
  /** Class 2 or 3 enters Next at this urgency or more. */
  class2or3MinUrgency: 50,
} as const;

// ============================================================================
// Today (plan 1.3 and design 2C)
// ============================================================================

export const MINUTES = {
  threadWithDraft: 2,
  threadNoDraft: 10,
  sessionAsk: 5,
  wait: 5,
  reviewBase: 10,
  reviewPerPiece: 1,
  reviewCap: 45,
  /** A task with no estimated_minutes and no energy estimate. */
  taskDefault: 30,
} as const;

/** Quick takes in-view items of this many minutes or less that have a person waiting or a hard date. */
export const QUICK_MAX_MINUTES = 10;

/** Free time is counted between these hours in his zone, less recovery after each timed meeting. */
export const DAY_WINDOW = {
  startHour: 10,
  endHour: 17,
  recoveryMinutes: 30,
} as const;

/** Group key and label for work with no client and no project. */
export const OWN_GROUP_LABEL = 'Indelible';

/** A step Mike removed is not proposed back into that group for this many days. */
export const ARC_REMOVED_SUPPRESS_DAYS = 7;

/** Longest arc order a single arc_reorder may send. */
export const ARC_STEP_KEYS_MAX = 50;

/** Longest "Where did you leave it?" note, in characters. */
export const LEFT_OFF_NOTE_MAX = 2000;

// ============================================================================
// Not now ladder, boosts and undo (plan 1.4, design 2A.5)
// ============================================================================

export const NOT_NOW = {
  /** First tap: back the next business day at this hour in his zone. */
  firstReturnHour: 9,
  /** Second tap: back after this many calendar days. */
  secondReturnDays: 7,
  /**
   * Once park_count reaches this, Not now is withdrawn: the item stays in view and its
   * buttons become its real choices plus "Let it go".
   */
  choicesOnlyAtParkCount: 3,
} as const;

/** Home-only actions undo through /api/home/undo for this long. */
export const UNDO_WINDOW_HOURS = 24;

// ============================================================================
// Slice 2: fresh tasks, the keeper, date reading, summaries, arcs. Internal only.
// ============================================================================

/**
 * A task assigned to him that carries `chatTag`, or that he created himself, shows in Next
 * for this many business days from creation (see isFreshNew).
 */
export const FRESH_NEW = { chatTag: 'from-chat', businessDays: 2 } as const;

/**
 * The nightly sort. `perDay` tasks come back on any business day (his own Not now returns
 * count toward it). `slotHour` and `slotMinute` are the Eastern time of day written into
 * view_at. `lineHours` is how long a keeper line stays in Handled for you, `undoHours` how
 * long its Undo stays open, `holdDays` how long an undone item is left alone.
 */
export const KEEPER = { perDay: 3, slotHour: 0, slotMinute: 5, lineHours: 72, undoHours: 72, holdDays: 30 } as const;

/**
 * Reading existing due dates, once per task. A due date 4 to 6 days after creation is an
 * invented default (set aside). A due date more than `deadPastDays` days in the past is set
 * aside. Anything else is read, with `unclearSource` as its source.
 */
export const DATE_READ = {
  inventedMinDays: 4,
  inventedMaxDays: 6,
  deadPastDays: 14,
  unclearSource: 'date from the task, source unclear',
} as const;

/** Slice 2b, card summaries written by Bast. */
export const SUMMARY = { minWords: 120, maxWords: 60, perRun: 40, maxInputChars: 6000 } as const;

/** Slice 2c, arc housekeeping. */
export const ARC_KEEPER = { staleDays: 21, maxCreatePerNight: 1, maxClosePerNight: 5, linkCap: 4 } as const;

/** What isFreshNew reads from a task. */
export interface FreshNewFields {
  tags: readonly string[];
  created_by_id: string | null;
  created_at: Date;
}

/**
 * True when the task (already known to be his and open) is tagged `from-chat` or was created
 * by him, and `now` is before the end of the second business day counted from creation
 * (addBusinessDays, 17:00 Eastern on that day). A blank userId is never the creator.
 */
export function isFreshNew(task: FreshNewFields, userId: string, now: Date): boolean {
  const chat = (task.tags ?? []).some((t) => t.trim().toLowerCase() === FRESH_NEW.chatTag);
  const mine = !!userId && !!task.created_by_id && task.created_by_id === userId;
  if (!chat && !mine) return false;
  return now.getTime() < addBusinessDays(task.created_at, FRESH_NEW.businessDays).getTime();
}

// ============================================================================
// Address and name predicates
// ============================================================================

/** Lowercased, trimmed bare address. Accepts "Name <a@b.c>" and returns "a@b.c". */
export function normalizeEmail(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.trim();
  const angled = s.match(/<([^<>]+)>/);
  return (angled ? angled[1] : s).trim().toLowerCase();
}

/** The domain part of an address, lowercased, or '' when there is none. */
export function emailDomain(raw: string | null | undefined): string {
  const e = normalizeEmail(raw);
  const at = e.lastIndexOf('@');
  return at >= 0 ? e.slice(at + 1) : '';
}

export function isOwnAddress(raw: string | null | undefined): boolean {
  const e = normalizeEmail(raw);
  return e !== '' && (OWN_ADDRESSES as readonly string[]).includes(e);
}

export function isNoiseSender(raw: string | null | undefined): boolean {
  const d = emailDomain(raw);
  if (!d) return false;
  return NOISE_SENDER_DOMAINS.some((n) => d === n || d.endsWith(`.${n}`));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive match of any phrase in `phrases` inside `text`. */
function containsPhrase(text: string | null | undefined, phrases: readonly string[]): boolean {
  if (!text) return false;
  return phrases.some((p) => {
    const words = p.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    return new RegExp(`(^|[^A-Za-z0-9])${words}($|[^A-Za-z0-9])`, 'i').test(text);
  });
}

export function isNoiseClientName(name: string | null | undefined): boolean {
  return containsPhrase(name, NOISE_CLIENT_NAMES);
}

/** Ruled noise: by sender domain, or by the linked client's name. */
export function isNoise(input: { from_email?: string | null; client_name?: string | null }): boolean {
  return isNoiseSender(input.from_email) || isNoiseClientName(input.client_name);
}

export function isAutomatedSender(raw: string | null | undefined): boolean {
  const e = normalizeEmail(raw);
  if (!e) return false;
  return AUTOMATED_SENDER_PATTERNS.some((p) => e.includes(p));
}

export function isCalendarSubject(subject: string | null | undefined): boolean {
  if (!subject) return false;
  const s = subject.trim().toLowerCase();
  return CALENDAR_SUBJECT_PREFIXES.some((p) => s.startsWith(p.toLowerCase()));
}

/**
 * The sender and subject half of the People rule (plan 1.3, first two bullets): not an own
 * address, not noise, not automated, not a calendar reply. The known-person and age halves
 * need the ask's links and the clock, and live in select.ts (H4).
 */
export function isPersonMessage(input: {
  from_email: string | null | undefined;
  subject: string | null | undefined;
  client_name?: string | null;
}): boolean {
  return (
    !!normalizeEmail(input.from_email) &&
    !isOwnAddress(input.from_email) &&
    !isNoise({ from_email: input.from_email, client_name: input.client_name }) &&
    !isAutomatedSender(input.from_email) &&
    !isCalendarSubject(input.subject)
  );
}

/** Other ventures: the client name or the project name names one. */
export function isVenture(input: { client_name?: string | null; project_name?: string | null }): boolean {
  return containsPhrase(input.client_name, VENTURE_NAMES) || containsPhrase(input.project_name, VENTURE_NAMES);
}

// ============================================================================
// Tag predicates
// ============================================================================

function lowerTags(tags: readonly string[] | null | undefined): string[] {
  return (tags ?? []).map((t) => t.trim().toLowerCase());
}

export function hasSecurityTag(tags: readonly string[] | null | undefined): boolean {
  return lowerTags(tags).some((t) => (SECURITY_TAGS as readonly string[]).includes(t));
}

/** Tag `lifeline`, or any tag starting `job-watch`. */
export function hasLifelineTag(tags: readonly string[] | null | undefined): boolean {
  return lowerTags(tags).some((t) => t === LIFELINE_TAG || t.startsWith(JOB_WATCH_TAG_PREFIX));
}

export function hasClientBlockingTag(tags: readonly string[] | null | undefined): boolean {
  return lowerTags(tags).includes(CLIENT_BLOCKING_TAG);
}

/** Importance money part, +25: security, security-report, lifeline or job-watch*. */
export function hasMoneyOrLifelineTag(tags: readonly string[] | null | undefined): boolean {
  return hasSecurityTag(tags) || hasLifelineTag(tags);
}

// ============================================================================
// Hard dates (plan 1.3)
// ============================================================================

export interface HardDateFields {
  due_date: Date | null;
  promised_to: string | null;
  tags: readonly string[];
}

/**
 * A task's due_date is a hard date only when promised_to is set, or the task carries a
 * lifeline tag (lifeline or job-watch*). Every other due date is ignored.
 */
export function hardDateOf(task: HardDateFields): Date | null {
  if (!task.due_date) return null;
  const promised = !!task.promised_to && task.promised_to.trim() !== '';
  return promised || hasLifelineTag(task.tags) ? task.due_date : null;
}

// ============================================================================
// Business-day counting (America/New_York, Monday to Friday, same as lib/waits)
// ============================================================================

interface Civil {
  y: number;
  m: number;
  d: number;
}

const MAX_SCAN_DAYS = 4000;

function civilOf(date: Date): Civil {
  const p = zonedParts(date);
  return { y: p.year, m: p.month, d: p.day };
}

function civilNum(c: Civil): number {
  return Date.UTC(c.y, c.m - 1, c.d) / 86_400_000;
}

function weekdayOfNum(n: number): number {
  return new Date(n * 86_400_000).getUTCDay();
}

function isBusinessNum(n: number): boolean {
  const w = weekdayOfNum(n);
  return w >= 1 && w <= 5;
}

/**
 * Business days from today to the target's civil date, in New York.
 * - 0 when the target falls today.
 * - Positive: the number of business days d with today < d <= target (a Saturday target
 *   seen on Thursday is 1).
 * - Negative when the target's date is before today: minus the business days d with
 *   target < d <= today, and never more than -1, so any past date reads below 0.
 */
export function businessDaysUntil(target: Date, now: Date): number {
  const a = civilNum(civilOf(now));
  const b = civilNum(civilOf(target));
  if (a === b) return 0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let count = 0;
  for (let n = lo + 1, i = 0; n <= hi && i < MAX_SCAN_DAYS; n++, i++) {
    if (isBusinessNum(n)) count++;
  }
  return b > a ? count : -Math.max(1, count);
}

/**
 * Whole business days elapsed since `since`, on the wait clock of lib/waits/business-days.ts:
 * the largest n with addBusinessDays(since, n) <= now, or 0 when even n = 0 has not passed.
 * Counting starts the same day for a business-day start before 17:00 New York, else the next
 * business day, and each day completes at 17:00. A future `since` gives 0.
 */
export function businessDaysElapsed(since: Date, now: Date): number {
  if (now.getTime() <= since.getTime()) return 0;
  const sp = zonedParts(since);
  let base = civilNum({ y: sp.year, m: sp.month, d: sp.day });
  if (!(isBusinessNum(base) && sp.hour < DUE_HOUR)) {
    base += 1;
    while (!isBusinessNum(base)) base += 1;
  }
  const np = zonedParts(now);
  const today = civilNum({ y: np.year, m: np.month, d: np.day });
  let completed = 0;
  for (let n = base, i = 0; n <= today && i < MAX_SCAN_DAYS; n++, i++) {
    if (!isBusinessNum(n)) continue;
    if (n < today || np.hour >= DUE_HOUR) completed++;
  }
  return Math.max(0, completed - 1);
}

// ============================================================================
// Emergency predicates (plan 1.3, rules 1 to 7)
// ============================================================================

/**
 * Which emergency rule an item meets. Internal: select.ts and copy.ts use it to place the
 * row and to word "Why it's here"; it is never sent to the browser.
 */
export type EmergencyRule =
  | 'security' // 1. security tag on a task with a site or client
  | 'lifeline' // 2. lifeline or job-watch* tag
  | 'client_blocking_tag' // 3. client-blocking tag
  | 'client_waiting' // 4. client-blocking wait, client waiting more than 1 business day
  | 'session_client_blocking' // 5. session ask with severity client_blocking
  | 'crisis_mail' // 6. open urgent mail, sender not noise
  | 'promised_date' // 7. promised hard date 2 business days away or less
  | 'site_down'; // Slice 6a: a client site is down (watchdog incident 10 minutes old, or an uptime mail Bast's own check confirmed)

export interface TaskEmergencyFields extends HardDateFields {
  site_id: string | null;
  client: { id: string; name: string } | null;
}

/** Rules 1, 2, 3 and 7, checked in that order. */
export function taskEmergencyRule(task: TaskEmergencyFields, now: Date): EmergencyRule | null {
  if (hasSecurityTag(task.tags) && (!!task.site_id || !!task.client)) return 'security';
  if (hasLifelineTag(task.tags)) return 'lifeline';
  if (hasClientBlockingTag(task.tags)) return 'client_blocking_tag';
  const promised = !!task.promised_to && task.promised_to.trim() !== '';
  if (promised && task.due_date && businessDaysUntil(task.due_date, now) <= PROMISED_DATE_EMERGENCY_BUSINESS_DAYS) {
    return 'promised_date';
  }
  return null;
}

export interface WaitEmergencyFields {
  blocks_client: boolean;
  client_waiting_since: Date | null;
}

/**
 * Rule 4. The caller passes only waits whose owner resolved to the signed-in user.
 * "More than 1 business day ago" means at least one whole business day has elapsed on the
 * wait clock (businessDaysElapsed >= 1).
 */
export function waitEmergencyRule(wait: WaitEmergencyFields, now: Date): EmergencyRule | null {
  if (!wait.blocks_client || !wait.client_waiting_since) return null;
  return businessDaysElapsed(wait.client_waiting_since, now) >= CLIENT_WAIT_EMERGENCY_BUSINESS_DAYS
    ? 'client_waiting'
    : null;
}

/** Rule 5. */
export function sessionEmergencyRule(session: { ask_severity: AskSeverity | null }): EmergencyRule | null {
  return session.ask_severity === 'client_blocking' ? 'session_client_blocking' : null;
}

export interface CrisisEmergencyFields {
  is_urgent: boolean;
  state: EmailAskState;
  from_email: string;
  client: { id: string; name: string } | null;
}

/** Rule 6: open, urgent, and neither the sender nor the linked client is ruled noise. */
export function crisisEmergencyRule(ask: CrisisEmergencyFields): EmergencyRule | null {
  if (!ask.is_urgent || ask.state !== 'open') return null;
  if (isNoise({ from_email: ask.from_email, client_name: ask.client?.name ?? null })) return null;
  return 'crisis_mail';
}
