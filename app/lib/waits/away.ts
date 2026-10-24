/**
 * Out of office stand-ins (specs/citadel-shape-SPEC.md 3.2 and 3.15, Saturday 10-24 run item 11).
 *
 * Pure rules over rows passed in, plus a Prisma lookup that reads the two tables. Nothing here
 * runs unless the OOO_STANDINS flag is on (the sweeper and the PATCH route check it first), and
 * no AwayWindow or StandIn row is seeded until Mike rules on the decision card
 * (indelible-ops/docs/overnight/2026-10-24-stand-ins.md).
 */

import { addBusinessDays } from './business-days';
import { getTemplate, type RoleKey } from './templates';

export interface AwayWindowRow {
  user_id: string;
  starts_at: Date;
  ends_at: Date;
  source: string;
  confirmed_at: Date | null;
}

export interface StandInRow {
  for_user_id: string;
  role_key: string;
  stand_in_user_id: string;
}

export interface AwayLookups {
  /** Windows that contain `at` (starts_at <= at < ends_at). */
  windowsActiveAt(at: Date): Promise<AwayWindowRow[]>;
  /** Every stand-in mapping (a handful of rows). */
  standIns(): Promise<StandInRow[]>;
}

/**
 * Waits that are Mike's alone and are never routed to a stand-in: any dollar amount, contracts,
 * ending a client, proposals. They pause until he is back plus one business day. This is the
 * decision card's pause list; it stays a proposal until Mike rules. A wait whose template key
 * cannot tell (change.needs_human and handoff.generic can carry a live plugin update or a client
 * exit) carries `mike_only = true` on the row instead.
 */
export const MIKE_ONLY_TEMPLATES: readonly string[] = [
  'sales.proposal_review',
  'sales.proposal_unopened',
  'sales.proposal_no_action',
  'sales.proposal_closing',
  'sales.proposal_call',
  'sales.proposal_dormant',
  'sales.audit_unopened',
  'sales.audit_no_booking',
  'sales.audit_closing',
  'sales.lead_dormant',
  'money.invoice',
  'charter.price_review',
  'charter.renewal',
  'maint.report_monthly',
  'switch.off',
];

/**
 * Templates whose role in the template does not say which stand-in covers them. The card routes
 * the emergency to the WordPress stand-in and the two front-door templates to the liaison stand-in.
 */
export const AWAY_ROLE_OVERRIDES: Readonly<Record<string, RoleKey>> = {
  'portal.emergency': 'wordpress',
  'portal.first_response': 'liaison',
  'meeting.type_unclear': 'liaison',
};

/** True when the template is on the Mike-only list or the wait itself is marked Mike-only. */
export function isMikeOnlyWait(wait: { template_key: string; mike_only?: boolean | null }): boolean {
  return wait.mike_only === true || MIKE_ONLY_TEMPLATES.includes(wait.template_key);
}

/** A window counts when Mike set it by hand, or a calendar proposal was confirmed. */
export function windowCounts(w: Pick<AwayWindowRow, 'source' | 'confirmed_at'>): boolean {
  return w.source === 'manual' || w.confirmed_at != null;
}

function windowsFor(windows: AwayWindowRow[], userId: string, at: Date): AwayWindowRow[] {
  return windows.filter(
    (w) => w.user_id === userId && windowCounts(w) && w.starts_at.getTime() <= at.getTime() && at.getTime() < w.ends_at.getTime()
  );
}

/** Is the user away at `at`, given windows. */
export function isAway(windows: AwayWindowRow[], userId: string, at: Date): boolean {
  return windowsFor(windows, userId, at).length > 0;
}

/** The latest end among the user's windows that contain `at`, or null when not away. */
export function awayUntil(windows: AwayWindowRow[], userId: string, at: Date): Date | null {
  const ws = windowsFor(windows, userId, at);
  if (ws.length === 0) return null;
  return new Date(Math.max(...ws.map((w) => w.ends_at.getTime())));
}

/** Mike-only waits resume at the window's end plus one business day. */
export function resumeAfterWindow(windowEnd: Date): Date {
  return addBusinessDays(windowEnd, 1);
}

/** The stand-in the away user named for a role, or null. */
export function standInForRole(rows: StandInRow[], awayUserId: string, role: string | null): string | null {
  if (!role) return null;
  return rows.find((r) => r.for_user_id === awayUserId && r.role_key === role)?.stand_in_user_id ?? null;
}

function payloadOf(wait: { action_payload?: unknown }): Record<string, unknown> {
  return wait.action_payload && typeof wait.action_payload === 'object'
    ? (wait.action_payload as Record<string, unknown>)
    : {};
}

/**
 * The role whose stand-in covers a wait: the card's override for the template, else the role the
 * owner resolution looked up, else the role the wait carries (a client-owned wait is shepherded by
 * the shepherd role, the liaison by default).
 */
export function awayRoleForWait(
  wait: { template_key: string; action_payload?: unknown },
  resolvedRole: RoleKey | null
): RoleKey | null {
  const override = AWAY_ROLE_OVERRIDES[wait.template_key];
  if (override) return override;
  if (resolvedRole) return resolvedRole;
  const payload = payloadOf(wait);
  let role = typeof payload.owner_role === 'string' ? (payload.owner_role as RoleKey) : null;
  if (!role) role = getTemplate(wait.template_key)?.owner ?? null;
  if (role === 'client') {
    return typeof payload.shepherd_role === 'string' ? (payload.shepherd_role as RoleKey) : 'liaison';
  }
  return role;
}

// ---------------------------------------------------------------------------
// Prisma implementation
// ---------------------------------------------------------------------------

type PrismaLike = {
  awayWindow: { findMany(args: unknown): Promise<AwayWindowRow[]> };
  standIn: { findMany(args: unknown): Promise<StandInRow[]> };
};

/** Lazy: constructing it queries nothing. Each method memoizes for the length of one pass. */
export function prismaAwayLookups(db: PrismaLike): AwayLookups {
  let windows: Promise<AwayWindowRow[]> | null = null;
  let standIns: Promise<StandInRow[]> | null = null;
  return {
    windowsActiveAt(at) {
      windows ??= db.awayWindow.findMany({
        where: {
          starts_at: { lte: at },
          ends_at: { gt: at },
          OR: [{ source: 'manual' }, { confirmed_at: { not: null } }],
        },
        select: { user_id: true, starts_at: true, ends_at: true, source: true, confirmed_at: true },
      });
      return windows;
    },
    standIns() {
      standIns ??= db.standIn.findMany({ select: { for_user_id: true, role_key: true, stand_in_user_id: true } });
      return standIns;
    },
  };
}
