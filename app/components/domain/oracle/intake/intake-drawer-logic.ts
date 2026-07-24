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
