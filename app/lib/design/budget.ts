/**
 * Designer Portal: budget rules (design 8.9, 7.1 POST /sessions/:id/budget, section 6 settings and DesignBudget).
 * Money is compared as numbers rounded to the cent; DB columns are Decimal.
 */
import type { DesignSession, PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { loadSessionFor } from './access';
import type { DesignActor } from './helpers';
import { createCommand } from './commands';

export const BUDGET_DEFAULTS = { designer_raise_cap_usd: 50, hard_session_cap_usd: 150 } as const;

const num = (v: { toString(): string } | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v.toString()));
const cents = (n: number) => Math.round(n * 100) / 100;

export interface BudgetLimits {
  designer_raise_cap_usd: number;
  hard_session_cap_usd: number;
  default_monthly_cap_usd: number | null;
}

export async function loadBudgetLimits(db: Pick<PrismaClient, 'designPortalSettings'> = defaultDb): Promise<BudgetLimits> {
  const s = await db.designPortalSettings.findUnique({ where: { id: 1 } });
  return {
    designer_raise_cap_usd: num(s?.designer_raise_cap_usd) ?? BUDGET_DEFAULTS.designer_raise_cap_usd,
    hard_session_cap_usd: num(s?.hard_session_cap_usd) ?? BUDGET_DEFAULTS.hard_session_cap_usd,
    default_monthly_cap_usd: num(s?.default_monthly_cap_usd),
  };
}

export type BudgetReason = 'session_ceiling' | 'monthly_cap';

export interface BudgetStatus {
  reached: boolean;
  reason: BudgetReason | null;
  cost_usd: number;
  budget_usd: number;
  month_spend_usd: number;
  monthly_cap_usd: number | null;
}

/** Pure predicate: cost >= ceiling, or this month's spend >= the monthly cap (null cap = off). */
export function budgetReachedPure(i: { cost_usd: number; budget_usd: number; month_spend_usd: number; monthly_cap_usd: number | null }): BudgetStatus {
  const sessionHit = cents(i.cost_usd) >= cents(i.budget_usd);
  const monthHit = i.monthly_cap_usd !== null && cents(i.month_spend_usd) >= cents(i.monthly_cap_usd);
  return { reached: sessionHit || monthHit, reason: sessionHit ? 'session_ceiling' : monthHit ? 'monthly_cap' : null, ...i };
}

/** [start, end) of the UTC calendar month containing `now`. */
export function monthBounds(now: Date = new Date()): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

/** Sum of `cost` events' turn_usd this calendar month across the user's sessions (server-side, 8.9). */
export async function monthSpend(userId: string, now: Date = new Date(), db: Pick<PrismaClient, '$queryRaw'> = defaultDb): Promise<number> {
  const { start, end } = monthBounds(now);
  const rows = await db.$queryRaw<{ total: string | null }[]>`
    SELECT COALESCE(SUM((e.payload->>'turn_usd')::numeric), 0)::text AS total
    FROM design_events e JOIN design_sessions s ON s.id = e.session_id
    WHERE e.kind = 'cost' AND s.designer_id = ${userId}::uuid
      AND e.created_at >= ${start} AND e.created_at < ${end}
      AND (e.payload->>'turn_usd') ~ '^[0-9]+(\\.[0-9]+)?$'`;
  return Number(rows[0]?.total ?? 0);
}

/** The designer's monthly cap: her DesignBudget row, else the settings default, else null (off). */
export async function monthlyCapFor(userId: string, db: Pick<PrismaClient, 'designBudget' | 'designPortalSettings'> = defaultDb): Promise<number | null> {
  const row = await db.designBudget.findUnique({ where: { user_id: userId } });
  if (row && row.monthly_cap_usd !== null) return num(row.monthly_cap_usd);
  return (await loadBudgetLimits(db)).default_monthly_cap_usd;
}

export async function budgetStatus(
  session: Pick<DesignSession, 'designer_id' | 'cost_usd' | 'budget_usd'>,
  now: Date = new Date(),
  db: Pick<PrismaClient, '$queryRaw' | 'designBudget' | 'designPortalSettings'> = defaultDb,
): Promise<BudgetStatus> {
  const [spend, cap] = await Promise.all([monthSpend(session.designer_id, now, db), monthlyCapFor(session.designer_id, db)]);
  return budgetReachedPure({ cost_usd: num(session.cost_usd) ?? 0, budget_usd: num(session.budget_usd) ?? 0, month_spend_usd: spend, monthly_cap_usd: cap });
}

/** The highest ceiling `actor` may set on a session owned by `ownerId`: admin up to the hard cap; a designer up to her cap (never above the hard cap). */
export async function raiseCapFor(actor: Pick<DesignActor, 'role'>, ownerId: string, db: Pick<PrismaClient, 'designBudget' | 'designPortalSettings'> = defaultDb): Promise<number> {
  const limits = await loadBudgetLimits(db);
  if (actor.role === 'admin') return limits.hard_session_cap_usd;
  const row = await db.designBudget.findUnique({ where: { user_id: ownerId } });
  const own = num(row?.session_raise_cap_usd) ?? limits.designer_raise_cap_usd;
  return Math.min(own, limits.hard_session_cap_usd);
}

/**
 * POST /sessions/:id/budget: raises only. 400 `not_a_raise` when the new ceiling is not above the current;
 * 403 `raise_cap` over the caller's cap. When the session sits in `paused_budget` and the raise clears both
 * the session ceiling and the monthly cap, a `resume` command is written in the same transaction.
 */
export async function raiseBudget(
  actor: DesignActor,
  sessionId: string,
  newBudgetUsd: number,
  db: PrismaClient = defaultDb,
): Promise<{ session: DesignSession; resume_command_id: string | null }> {
  if (!Number.isFinite(newBudgetUsd) || newBudgetUsd <= 0) throw new ApiError('budget_usd must be a positive number', 400, 'bad_budget');
  const loaded = await loadSessionFor(actor, sessionId, { mode: 'write' }, db);
  const target = cents(newBudgetUsd);
  const cap = await raiseCapFor(actor, loaded.designer_id, db);
  if (target > cap) throw new ApiError(`You can raise this session to at most $${cap}`, 403, 'raise_cap');
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ budget_usd: string }[]>`SELECT budget_usd::text AS budget_usd FROM design_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    if (cents(Number(locked[0].budget_usd)) >= target) throw new ApiError('A raise must be above the current budget', 400, 'not_a_raise');
    const session = await tx.designSession.update({ where: { id: sessionId }, data: { budget_usd: target } });
    let resume: string | null = null;
    if (session.status === 'paused_budget') {
      const st = await budgetStatus(session, new Date(), tx as unknown as PrismaClient);
      if (!st.reached) resume = (await createCommand({ sessionId, verb: 'resume', createdById: actor.userId }, tx)).command.id;
    }
    return { session, resume_command_id: resume };
  });
}
