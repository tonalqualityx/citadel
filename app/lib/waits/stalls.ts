/**
 * Stall detection for engagement briefs (Fleet item 1).
 *
 * For each brief in `dry` or `live`, look at the open tasks in its scope and open an
 * `engagement.stalled` wait (due now) on any task a stall rule says is stuck, unless an open wait
 * already covers that task. The wait rides the ladder that already exists (sweeper.ts escalate():
 * role holder, PM, Mike, one business day each) and the template drops one in-app notice per rung.
 *
 *   not started   more than not_started_bd business days since the task was created
 *   in progress   more than in_progress_bd since it started, with no comment in that time and no live lease
 *   blocked       every blocker is done and the last one finished more than blocked_resolved_bd ago
 *   review        client_approved_at is more than review_approved_bd old and the task is still in review
 *
 * A rule with no number in the brief is off. `dryRun` (the sweep's, or a brief in `dry` mode) reports
 * and writes nothing. Pure over `StallStore` + `SweepStore`, so it is unit-tested against memory.
 */

import type { PrismaClient } from '@prisma/client';
import { businessDaysLate } from './business-days';
import { ROLE_FUNCTION_NAMES } from './owner';
import type { SweepStore, WaitRow } from './sweeper';
import { buildWaitData, type RoleKey } from './templates';
import { OPEN_TASK_STATUSES, parseStallRules, scopeWhere, type StallRules } from '@/lib/engagement/brief';

export type StallRule = 'not_started' | 'in_progress' | 'blocked_resolved' | 'review_approved';

export interface StallBrief {
  id: string;
  label: string;
  client_id: string | null;
  project_id: string | null;
  charter_id: string | null;
  owner_mode: string;
  release_owner_role: string;
  stall_rules: unknown;
  scope: unknown;
}

export interface StallTask {
  id: string;
  title: string;
  status: string;
  client_id: string | null;
  project_id: string | null;
  charter_id: string | null;
  created_at: Date;
  started_at: Date | null;
  client_approved_at: Date | null;
  lease_until: Date | null;
  last_comment_at: Date | null;
  blockers: Array<{ status: string; completed_at: Date | null; updated_at: Date }>;
}

export interface StallStore {
  /** Briefs whose owner_mode is dry or live. */
  listBriefs(): Promise<StallBrief[]>;
  /** Open tasks in the brief's scope. */
  listOpenTasks(brief: StallBrief): Promise<StallTask[]>;
  /** The subset of these task ids that already have an open wait (any template). */
  tasksWithOpenWait(taskIds: string[]): Promise<Set<string>>;
  /** A function id whose name fills the role, for a wait's owner_function_id. */
  functionIdForRole(role: string): Promise<string | null>;
}

export interface StallFinding {
  brief_id: string;
  task_id: string;
  title: string;
  rule: StallRule;
  detail: string;
  /** opened = a wait was written; would_open = reported only (dry). */
  outcome: 'opened' | 'would_open';
  wait_id?: string;
}

export interface StallReport {
  at: string;
  dry_run: boolean;
  briefs: number;
  findings: StallFinding[];
  /** Stalled tasks past the brief's max_new_per_pass, left for the next pass. */
  deferred: number;
  opened: WaitRow[];
}

export const DEFAULT_MAX_NEW_PER_PASS = 10;

/** The first rule that holds for a task, or null. Pure. */
export function stallFor(task: StallTask, rules: StallRules, now: Date): { rule: StallRule; detail: string } | null {
  if (task.status === 'not_started' && rules.not_started_bd) {
    const n = businessDaysLate(task.created_at, now);
    if (n > rules.not_started_bd) return { rule: 'not_started', detail: `Not started, ${n} business days since it was created.` };
  }
  if (task.status === 'in_progress' && rules.in_progress_bd) {
    const since = task.started_at ?? task.created_at;
    const lastTouch = task.last_comment_at && task.last_comment_at > since ? task.last_comment_at : since;
    const n = businessDaysLate(lastTouch, now);
    const leased = !!task.lease_until && task.lease_until.getTime() > now.getTime();
    if (n > rules.in_progress_bd && !leased) return { rule: 'in_progress', detail: `In progress with no comment for ${n} business days and no live lease.` };
  }
  if (task.status === 'blocked' && rules.blocked_resolved_bd && task.blockers.length > 0) {
    if (task.blockers.every((b) => b.status === 'done')) {
      const last = Math.max(...task.blockers.map((b) => (b.completed_at ?? b.updated_at).getTime()));
      const n = businessDaysLate(new Date(last), now);
      if (n > rules.blocked_resolved_bd) return { rule: 'blocked_resolved', detail: `Blocked, but every blocker finished ${n} business days ago.` };
    }
  }
  if (task.status === 'review' && rules.review_approved_bd && task.client_approved_at) {
    const n = businessDaysLate(task.client_approved_at, now);
    if (n > rules.review_approved_bd) return { rule: 'review_approved', detail: `Client approved it ${n} business days ago and it is still in review.` };
  }
  return null;
}

export async function detectStalls(
  now: Date,
  opts: { dryRun?: boolean },
  deps: { store: SweepStore; stalls: StallStore }
): Promise<StallReport> {
  const report: StallReport = { at: now.toISOString(), dry_run: !!opts.dryRun, briefs: 0, findings: [], deferred: 0, opened: [] };
  const day = now.toISOString().slice(0, 10);
  for (const brief of await deps.stalls.listBriefs()) {
    if (brief.owner_mode !== 'dry' && brief.owner_mode !== 'live') continue;
    report.briefs++;
    const rules = parseStallRules(brief.stall_rules);
    if (!rules.not_started_bd && !rules.in_progress_bd && !rules.blocked_resolved_bd && !rules.review_approved_bd) continue;
    const tasks = await deps.stalls.listOpenTasks(brief);
    const stalled = tasks
      .map((t) => ({ t, hit: stallFor(t, rules, now) }))
      .filter((x): x is { t: StallTask; hit: { rule: StallRule; detail: string } } => !!x.hit);
    if (!stalled.length) continue;
    const covered = await deps.stalls.tasksWithOpenWait(stalled.map((x) => x.t.id));
    const fresh = stalled.filter((x) => !covered.has(x.t.id));
    const cap = rules.max_new_per_pass ?? DEFAULT_MAX_NEW_PER_PASS;
    // Oldest first, so the longest-stuck task gets the first slot.
    fresh.sort((a, b) => a.t.created_at.getTime() - b.t.created_at.getTime());
    report.deferred += Math.max(0, fresh.length - cap);
    const writes = brief.owner_mode === 'live' && !opts.dryRun;
    const fnId = writes ? await deps.stalls.functionIdForRole(brief.release_owner_role) : null;
    for (const { t, hit } of fresh.slice(0, cap)) {
      const finding: StallFinding = {
        brief_id: brief.id,
        task_id: t.id,
        title: t.title,
        rule: hit.rule,
        detail: hit.detail,
        outcome: writes ? 'opened' : 'would_open',
      };
      if (writes) {
        const data = buildWaitData({
          template_key: 'engagement.stalled',
          subject: t.title.slice(0, 200),
          detail: `${hit.detail} Brief: ${brief.label}.`,
          due_at: now,
          started_at: now,
          task_id: t.id,
          client_id: t.client_id ?? brief.client_id,
          project_id: t.project_id ?? brief.project_id,
          charter_id: t.charter_id ?? brief.charter_id,
          owner_function_id: fnId,
          created_by_automation: 'engagement-stalls',
          idempotency_key: `engagement-stall:${t.id}:${day}`,
          action_payload: { reference: `brief:${brief.id}`, note: hit.rule },
        });
        const made = await deps.store.insertIdempotent(data);
        if (made.created) {
          await deps.store.addEvent({
            wait_id: made.wait.id,
            kind: 'created',
            to_state: 'waiting',
            to_due_at: made.wait.due_at,
            reason: `Stall rule ${hit.rule} held on task ${t.id}.`,
            source: 'sweeper',
          });
          report.opened.push(made.wait);
          finding.wait_id = made.wait.id;
        } else {
          continue; // same task, same day: an earlier pass already opened it
        }
      }
      report.findings.push(finding);
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Prisma implementation
// ---------------------------------------------------------------------------

export function prismaStallStore(db: PrismaClient): StallStore {
  return {
    async listBriefs() {
      return db.engagementBrief.findMany({ where: { owner_mode: { in: ['dry', 'live'] } }, orderBy: { created_at: 'asc' } });
    },
    async listOpenTasks(brief) {
      const where = scopeWhere(brief);
      if (!where) return [];
      const rows = await db.task.findMany({
        where: { AND: [where, { status: { in: [...OPEN_TASK_STATUSES] } }] },
        select: {
          id: true,
          title: true,
          status: true,
          client_id: true,
          project_id: true,
          charter_id: true,
          created_at: true,
          started_at: true,
          client_approved_at: true,
          lease_until: true,
          comments: { where: { is_deleted: false }, orderBy: { created_at: 'desc' }, take: 1, select: { created_at: true } },
          blocked_by: { select: { status: true, completed_at: true, updated_at: true } },
        },
        orderBy: { created_at: 'asc' },
        take: 1000,
      });
      return rows.map((r): StallTask => ({
        id: r.id,
        title: r.title,
        status: r.status,
        client_id: r.client_id,
        project_id: r.project_id,
        charter_id: r.charter_id,
        created_at: r.created_at,
        started_at: r.started_at,
        client_approved_at: r.client_approved_at,
        lease_until: r.lease_until,
        last_comment_at: r.comments[0]?.created_at ?? null,
        blockers: r.blocked_by,
      }));
    },
    async tasksWithOpenWait(taskIds) {
      if (!taskIds.length) return new Set();
      const rows = await db.wait.findMany({
        where: { task_id: { in: taskIds }, state: { in: ['waiting', 'needs_human', 'blocked_by_switch', 'paused'] } },
        select: { task_id: true },
      });
      return new Set(rows.map((r) => r.task_id).filter((x): x is string => !!x));
    },
    async functionIdForRole(role) {
      const names = ROLE_FUNCTION_NAMES[role as RoleKey];
      if (!names?.length) return null;
      const f = await db.function.findFirst({ where: { name: { in: names } }, select: { id: true }, orderBy: { name: 'asc' } });
      return f?.id ?? null;
    },
  };
}

