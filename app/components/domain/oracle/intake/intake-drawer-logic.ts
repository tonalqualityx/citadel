// Clarity Phase 4a — the intake drawer. Pure formatting so the render component stays a
// dumb presentational layer, same split as needs-reshi-logic.ts / crisis-strip-logic.ts.

/** "2:41 PM" in the given IANA zone — always render in the RESOLVED user timezone, never
 *  the browser's implicit locale zone (the exact class of bug Phase 3d fixed elsewhere on
 *  this page — see lib/services/user-timezone.ts). */
export function formatNewestAt(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
}

/** The collapsed summary line's full text: "📬 Intake · N" (+ newest time when there's at
 *  least one item — an empty drawer has nothing to report a time for). Retained for the
 *  all-lanes-zero fallback (see intakeChipLine below) — Clarity Phase 6 replaced this as
 *  the header trigger's normal-state text with the three-lane count chip. */
export function intakeSummaryLine(count: number, newestAt: string | null, timezone: string): string {
  const base = `📬 Intake · ${count}`;
  if (count === 0 || !newestAt) return base;
  return `${base} · newest ${formatNewestAt(newestAt, timezone)}`;
}

// Clarity Phase 6 — email lanes & calendar intents.
// Clarity Phase 6b (2026-07-24, Mike's ruling) — `admin` lane added for
// business-critical non-client mail (accountant, bookkeeper, banking, tax): "if I don't
// take care of those emails I don't get paid." Placed FIRST in both the chip and the
// drawer order — it's the don't-get-paid lane, the one Mike least wants buried.

export type EmailAskLane = 'general' | 'meeting' | 'sales' | 'admin';

export interface LaneCounts {
  general: number;
  meeting: number;
  sales: number;
  admin: number;
}

/** null intent renders as "general" everywhere — the drawer/trigger chip never show an
 *  "unclassified" state (per EmailAskIntent's own schema doc comment). `admin` is a real,
 *  explicit intent value (never a null-fallback), so it passes through like meeting/sales. */
export function laneForAsk(ask: { intent: EmailAskLane | null }): EmailAskLane {
  return ask.intent ?? 'general';
}

// Trigger-chip order: admin, general, meeting, sales — admin FIRST (Phase 6b's priority
// ruling), the remaining three per the original spec's own example "📬 4 · 🤝 1 · 💰 2".
// Deliberately a DIFFERENT order from the drawer's own grouping order below — both orders
// are independently specified, not a shared constant, so don't collapse them into one
// "the" order.
const CHIP_ORDER: EmailAskLane[] = ['admin', 'general', 'meeting', 'sales'];
const CHIP_EMOJI: Record<EmailAskLane, string> = { admin: '🧾', general: '📬', meeting: '🤝', sales: '💰' };

/** The header trigger chip's text: one quiet count per non-empty lane ("🧾 1 · 📬 4 · 🤝 1 ·
 *  💰 2"), each zero-count lane rendering NOTHING (exception display, not a "0" badge).
 *  When every lane is zero, falls back to the existing quiet all-zero line ("📬 Intake ·
 *  0") rather than rendering nothing at all — the trigger chip is a stable, always-there
 *  landmark. */
export function intakeChipLine(lanes: LaneCounts): string {
  const parts = CHIP_ORDER.filter((lane) => lanes[lane] > 0).map((lane) => `${CHIP_EMOJI[lane]} ${lanes[lane]}`);
  // All-zero fallback is timezone-independent (count 0 -> intakeSummaryLine never touches
  // its timezone param), so no real zone needs to be threaded in just for this branch.
  if (parts.length === 0) return intakeSummaryLine(0, null, 'America/New_York');
  return parts.join(' · ');
}

// Drawer grouping order: Admin, Meeting, Sales, General — admin FIRST per Phase 6b's
// ruling (it's the don't-get-paid lane); Meeting/Sales/General retain their original
// relative order from Phase 6's own literal spec text.
const DRAWER_LANE_ORDER: EmailAskLane[] = ['admin', 'meeting', 'sales', 'general'];
const DRAWER_LANE_LABEL: Record<EmailAskLane, string> = {
  admin: 'Admin',
  meeting: 'Meeting',
  sales: 'Sales',
  general: 'General',
};

export interface LaneGroup<T> {
  lane: EmailAskLane;
  label: string;
  asks: T[];
}

/** Groups intake items by lane in the drawer's fixed Meeting/Sales/General order,
 *  skipping any lane with zero items entirely (no empty-lane headers). */
export function groupAsksByLane<T extends { intent: EmailAskLane | null }>(asks: T[]): LaneGroup<T>[] {
  return DRAWER_LANE_ORDER.map((lane) => ({
    lane,
    label: DRAWER_LANE_LABEL[lane],
    asks: asks.filter((ask) => laneForAsk(ask) === lane),
  })).filter((group) => group.asks.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Intake collapse (2026-08-03, Mike's ruling in the Monday ritual).
//
// The drawer rendered one row per MESSAGE. On the day this was written that meant
// 46 rows standing for 23 real things, and a single ow-staff thread accounted for
// 24 of the 46 — over half the drawer was one announcement plus its reply chorus.
// Mike: "The thing I must see is the announcement. The rest is basically fun."
//
// Two DIFFERENT collapses are needed, and conflating them gets one of them wrong:
//
//   thread — many messages, ONE thread_id. A conversation. The signal is the
//            OPENING message (the announcement / the ask); later messages are the
//            chorus. Anchor = oldest.
//   series — many messages, MANY thread_ids, same automated sender repeating the
//            same report ("Saiph triage digest — Jul 31 / Aug 1 / Aug 2 / Aug 3").
//            Thread grouping does nothing for these. The signal is the LATEST one;
//            the earlier ones are superseded. Anchor = newest.
//
// Every group also carries `newest` regardless of which end the anchor came from,
// because Mike asked for both: the thing he must see, AND a note about the most
// recent activity.
// ─────────────────────────────────────────────────────────────────────────────

export type CollapseKind = 'thread' | 'series' | 'single';

export interface CollapsibleAsk {
  id: string;
  /** Nullable on EmailAsk. A null thread_id means "we don't know what conversation this
   *  belongs to" — such messages must each stand alone, never be piled together into one
   *  bogus null-keyed thread. */
  thread_id: string | null;
  from_email: string;
  subject: string;
  received_at: string;
  intent: EmailAskLane | null;
}

export interface CollapsedGroup<T> {
  kind: CollapseKind;
  /** Stable identity for React keys and bulk actions (thread id, or sender+stem). */
  key: string;
  lane: EmailAskLane;
  /** The message that carries the signal — oldest for a thread, newest for a series. */
  anchor: T;
  /** The most recent message in the group (=== anchor for a series or a single). */
  newest: T;
  /** How many messages this row stands for. */
  total: number;
  /** Messages beyond the anchor — the "23 replies since" count. */
  since: number;
  /** Every member, oldest first, for the expanded view. */
  items: T[];
}

/** Ascending by received_at, with id as a deterministic tiebreak so equal timestamps
 *  (the classifier stamps a whole batch with one `datetime.now()`) never produce an
 *  unstable anchor. */
function byReceivedAsc<T extends CollapsibleAsk>(a: T, b: T): number {
  const t = Date.parse(a.received_at) - Date.parse(b.received_at);
  return t !== 0 ? t : a.id.localeCompare(b.id);
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';

/** Reduces a subject to the stem shared across one recurring report's instalments, so
 *  "Saiph triage digest — Aug 3" and "… — Jul 31" land on the same key.
 *
 *  Deliberately conservative — it strips only tails that are unambiguously an
 *  instalment marker (a trailing date, a trailing ISO date, an issue number), never a
 *  trailing word. Over-stripping would fuse genuinely different mail: note that
 *  "…invoice is available for whoismikedion.com" and "…for becomeindelible.com" keep
 *  their distinct domains and correctly stay apart. */
export function seriesStem(subject: string): string {
  let s = subject.trim();
  // trailing "— Aug 3" / "- Jul 31, 2026" / "Aug 3" (em dash, en dash, or hyphen)
  s = s.replace(
    new RegExp(`[\\u2014\\u2013-]?\\s*(${MONTHS})\\w*\\.?\\s+\\d{1,2}(,?\\s*\\d{4})?\\s*$`, 'i'),
    ''
  );
  // trailing ISO date, with or without a leading separator
  s = s.replace(/[—–-]?\s*\d{4}-\d{2}-\d{2}\s*$/, '');
  // issue/invoice numbers anywhere ("Invoice #3350" and "#3353" are one series)
  s = s.replace(/#\d+/g, '');
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** A series needs a stem substantial enough to be meaningful — collapsing on "re:" or
 *  a two-letter remnant would fuse unrelated mail. */
const MIN_SERIES_STEM = 8;

function makeGroup<T extends CollapsibleAsk>(
  kind: CollapseKind,
  key: string,
  sorted: T[],
  anchor: T
): CollapsedGroup<T> {
  return {
    kind,
    key,
    lane: laneForAsk(anchor),
    anchor,
    newest: sorted[sorted.length - 1],
    total: sorted.length,
    since: sorted.length - 1,
    items: sorted,
  };
}

/** Collapses a flat list of intake messages into the rows the drawer should actually
 *  render: multi-message threads, then recurring series among what's left, then true
 *  singletons. Result is ordered newest-activity first.
 *
 *  Series grouping is applied ONLY to messages that are alone in their own thread. A
 *  message already inside a real conversation belongs to that conversation; letting it
 *  also match a series key would double-count it and split a thread across two rows. */
export function collapseAsks<T extends CollapsibleAsk>(asks: T[]): CollapsedGroup<T>[] {
  const byThread = new Map<string, T[]>();
  for (const ask of asks) {
    // A null thread_id gets a key unique to the message, so unknowns stay separate.
    const key = ask.thread_id ?? ` nothread:${ask.id}`;
    const bucket = byThread.get(key);
    if (bucket) bucket.push(ask);
    else byThread.set(key, [ask]);
  }

  const groups: CollapsedGroup<T>[] = [];
  const loners: T[] = [];
  for (const [threadId, members] of byThread) {
    if (members.length > 1) {
      const sorted = [...members].sort(byReceivedAsc);
      // A conversation's signal is where it STARTED.
      groups.push(makeGroup('thread', `thread:${threadId}`, sorted, sorted[0]));
    } else {
      loners.push(members[0]);
    }
  }

  const bySeries = new Map<string, T[]>();
  for (const ask of loners) {
    const stem = seriesStem(ask.subject);
    const key = `${(ask.from_email || '').toLowerCase()}|${stem}`;
    if (stem.length < MIN_SERIES_STEM) {
      groups.push(makeGroup('single', `single:${ask.id}`, [ask], ask));
      continue;
    }
    const bucket = bySeries.get(key);
    if (bucket) bucket.push(ask);
    else bySeries.set(key, [ask]);
  }

  for (const [key, members] of bySeries) {
    const sorted = [...members].sort(byReceivedAsc);
    if (sorted.length > 1) {
      // A repeating report's signal is the LATEST instalment; earlier ones are superseded.
      groups.push(makeGroup('series', `series:${key}`, sorted, sorted[sorted.length - 1]));
    } else {
      groups.push(makeGroup('single', `single:${sorted[0].id}`, sorted, sorted[0]));
    }
  }

  return groups.sort((a, b) => {
    const t = Date.parse(b.newest.received_at) - Date.parse(a.newest.received_at);
    return t !== 0 ? t : a.key.localeCompare(b.key);
  });
}

/** The collapsed row's activity line: "24 messages · 23 replies since · newest 2:41 PM"
 *  for a thread, "4 reports · newest 7:15 AM" for a series, and just the time for a
 *  single. Returns the pieces already joined — the component stays presentational. */
export function collapseSummaryLine<T extends CollapsibleAsk>(
  group: CollapsedGroup<T>,
  timezone: string
): string {
  const newest = `newest ${formatNewestAt(group.newest.received_at, timezone)}`;
  if (group.kind === 'single') return newest;
  if (group.kind === 'series') return `${group.total} reports · ${newest}`;
  const replies = group.since === 1 ? '1 reply since' : `${group.since} replies since`;
  return `${group.total} messages · ${replies} · ${newest}`;
}

/** "📅 Thu 7/24 · 3:30 PM · 45m" in the given IANA zone — the meeting-lane card's
 *  prominent parsed-time display. Only ever called when proposed_event_at is set (a
 *  high-confidence classifier parse); minutes is omitted from the string when absent. */
export function formatProposedEvent(iso: string, minutes: number | null, timezone: string): string {
  const date = new Date(iso);
  // Built from two separate toLocaleDateString calls (not one combined weekday+month+day
  // call) specifically to avoid the built-in "Thu, 7/24" comma en-US inserts between
  // weekday and date — the spec's exact format has a bare space instead.
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone });
  const monthDay = date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: timezone });
  const time = formatNewestAt(iso, timezone);
  const minutesPart = minutes != null ? ` · ${minutes}m` : '';
  return `📅 ${weekday} ${monthDay} · ${time}${minutesPart}`;
}

export type CalendarButtonState = 'none' | 'add' | 'queued' | 'added';

/** Derives the Add-to-calendar affordance's state, purely from the ask's own fields:
 *  - no proposed_event_at at all -> 'none' (NO button — never guess, per Mike's explicit
 *    "confidence rule" requirement — a meeting-lane card with no high-confidence parsed
 *    date shows no button whatsoever, not a disabled one).
 *  - calendar_event_id set -> 'added' (the machine-side cron already created the real
 *    Google Calendar event).
 *  - calendar_requested true (and no calendar_event_id yet) -> 'queued' (Mike clicked Add
 *    to calendar; resolved from his perspective immediately, same pattern as
 *    archive_requested — the machine-side cron executes within ~15 min).
 *  - otherwise -> 'add' (the clickable button itself).
 */
export function calendarButtonState(ask: {
  proposed_event_at: string | null;
  calendar_requested: boolean;
  calendar_event_id: string | null;
}): CalendarButtonState {
  if (!ask.proposed_event_at) return 'none';
  if (ask.calendar_event_id) return 'added';
  if (ask.calendar_requested) return 'queued';
  return 'add';
}

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q4/Q11) — the intake attach picker's
// search-select: a mixed, filtered list of open arcs + open tasks. Kept a plain array
// (never a >12-row browse-everything list) — this is a quick "attach to the thing I
// already have in mind" gesture, not a full search UI.
export interface AttachPickerResult {
  kind: 'arc' | 'task';
  id: string;
  label: string;
}

const ATTACH_PICKER_RESULT_LIMIT = 12;

export function attachPickerResults(
  arcs: Array<{ id: string; name: string }>,
  tasks: Array<{ id: string; title: string }>,
  query: string
): AttachPickerResult[] {
  const q = query.trim().toLowerCase();
  const arcResults: AttachPickerResult[] = arcs
    .filter((a) => !q || a.name.toLowerCase().includes(q))
    .map((a) => ({ kind: 'arc' as const, id: a.id, label: a.name }));
  const taskResults: AttachPickerResult[] = tasks
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .map((t) => ({ kind: 'task' as const, id: t.id, label: t.title }));
  return [...arcResults, ...taskResults].slice(0, ATTACH_PICKER_RESULT_LIMIT);
}
