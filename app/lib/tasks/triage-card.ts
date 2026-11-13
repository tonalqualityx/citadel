/**
 * Triage tab payload (plan decisions 1, 2 and 4): everything one Triage card needs on the home screen and the card page, read in a
 * handful of queries however many cards there are. Owner-only data: callers (loadTriage, the per-card route) check the caller first.
 *
 * A project_setup card carries a project block: phases (name, summary, mike_part), "what will be Mike's" (the mike_part lines),
 * the signed contract (Project -> accord -> contract) with a link to the deal page, and the sitemap (ProjectPage rows). It never
 * carries the plan folder, a task, or anything from the plan folder's contents: those columns are not selected.
 */
import type { PrismaClient } from '@prisma/client';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import type { HomeAskedAfterRelease, HomeTriageCard, HomeTriageProject } from '@/lib/home/types';
import { LOOKS_DONE_PREFIX, LOOKS_DONE_TAG, evidenceOf, evidenceParts } from './looks-done';
import { FROM_TRIAGE_TAG, planRelease, pmReleaseHold, type TriageKindName } from './triage-kind';
import { releaseVersion } from './triage-version';
import { openQuestionCounts } from './questions';
import { recentChanges } from './triage-rev';
import { planLine } from './plan-summary';
import { SUMMARY_HEAD_CHARS, summaryFromHead } from './triage-summary';
import { readDeals } from '@/lib/deals/read';
import { sessionChangesFor } from '@/lib/triage-desk/changes';

type Db = Pick<PrismaClient, 'task' | 'comment' | 'taskQuestion' | 'project' | 'projectPhase' | 'projectPage' | 'contract' | 'accord' | 'accordCommissionItem' | 'charter' | 'client' | 'taskPlanItem' | '$queryRaw'>;

const DAY_MS = 86_400_000;

/** The newest internal "Looks done: " comment on each task: its id and evidence line. Client-visible and deleted comments never count. */
export async function evidenceFor(db: Pick<Db, 'comment'>, taskIds: string[]): Promise<Map<string, { id: string; evidence: string }>> {
  const out = new Map<string, { id: string; evidence: string }>();
  if (taskIds.length === 0) return out;
  const comments = await db.comment.findMany({
    where: { task_id: { in: taskIds }, is_deleted: false, is_internal: true, client_visible: false, content: { startsWith: LOOKS_DONE_PREFIX } },
    select: { id: true, task_id: true, content: true },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  for (const c of comments) {
    if (out.has(c.task_id)) continue;
    const evidence = evidenceOf(c.content);
    if (evidence) out.set(c.task_id, { id: c.id, evidence });
  }
  return out;
}

/** Open questions of these tasks with the field Release reads (if_nobody_action), by task. */
export async function openQuestionRows(db: Pick<Db, 'taskQuestion'>, taskIds: string[]): Promise<Map<string, { id: string; if_nobody_action: string }[]>> {
  const out = new Map<string, { id: string; if_nobody_action: string }[]>();
  if (taskIds.length === 0) return out;
  const rows = await db.taskQuestion.findMany({ where: { task_id: { in: taskIds }, state: 'open' }, select: { id: true, task_id: true, if_nobody_action: true }, orderBy: { id: 'asc' } });
  for (const r of rows) out.set(r.task_id, [...(out.get(r.task_id) ?? []), { id: r.id, if_nobody_action: r.if_nobody_action }]);
  return out;
}

/** Counts by what Release does with them: `go` follow the recommendation, `wait` wait for him. */
export function questionSplit(rows: { if_nobody_action: string }[] | undefined): { go: number; wait: number } {
  const all = rows ?? [];
  const go = all.filter((q) => q.if_nobody_action === 'go_with_recommendation').length;
  return { go, wait: all.length - go };
}

/**
 * Task ids whose text may have come from a client: a task from a client email or the portal, one with a requesting contact, a linked
 * email ask, or a comment a client contact wrote. Mike's and agents' text is not in this set. Used by the chat's reach check.
 */
export async function clientTextTaskIds(db: Pick<Db, 'task'> & { comment: Db['comment'] }, taskIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (taskIds.length === 0) return out;
  const tasks = await db.task.findMany({
    where: { id: { in: taskIds }, OR: [{ source: { in: ['email', 'portal'] } }, { requested_by_contact_id: { not: null } }, { email_asks: { some: {} } }] },
    select: { id: true },
  });
  for (const t of tasks) out.add(t.id);
  const comments = await db.comment.findMany({ where: { task_id: { in: taskIds }, is_deleted: false, author_contact_id: { not: null } }, select: { task_id: true }, distinct: ['task_id'] });
  for (const c of comments) out.add(c.task_id);
  return out;
}

/** One line per task from the first SUMMARY_HEAD_CHARS of its description, read in SQL so whole bodies are never loaded. */
export async function summariesFor(db: Pick<Db, '$queryRaw'>, taskIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (taskIds.length === 0) return out;
  const rows = await db.$queryRaw<{ id: string; head: string | null }[]>`SELECT id::text AS id, left(description, ${SUMMARY_HEAD_CHARS}::int) AS head FROM tasks WHERE id = ANY(${taskIds}::uuid[])`;
  for (const r of rows) out.set(r.id, summaryFromHead(r.head));
  return out;
}

/** Project blocks for the given project ids. */
export async function projectBlocks(db: Db, projectIds: string[]): Promise<Map<string, HomeTriageProject>> {
  const out = new Map<string, HomeTriageProject>();
  if (projectIds.length === 0) return out;
  // plan_folder is deliberately not selected anywhere in this file.
  const rows = (await db.project.findMany({
    where: { id: { in: projectIds }, is_deleted: false },
    select: { id: true, name: true, status: true, start_date: true, target_date: true, accord_id: true, accord: { select: { id: true, name: true } } },
  })) as { id: string; name: string; status: string; start_date: Date | null; target_date: Date | null; accord_id: string | null; accord: { id: string; name: string } | null }[];
  const phases = await db.projectPhase.findMany({
    where: { project_id: { in: projectIds } },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    select: { id: true, project_id: true, name: true, summary: true, mike_part: true },
  });
  const pages = await db.projectPage.findMany({
    where: { project_id: { in: projectIds } },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    select: { id: true, project_id: true, name: true, page_type: true, needs_design: true, notes: true },
  });
  const accordIds = rows.map((r) => r.accord_id).filter((x): x is string => !!x);
  const contracts = accordIds.length
    ? await db.contract.findMany({
        where: { accord_id: { in: accordIds }, is_deleted: false },
        orderBy: [{ version: 'desc' }],
        select: { accord_id: true, status: true, signed_at: true, version: true },
      })
    : [];
  // The deal with its items, for each project (read-only; lib/deals/read.ts says how a project is tied to its deal).
  const details = new Map<string, Awaited<ReturnType<typeof readDeals>>>();
  for (const p of rows) details.set(p.id, await readDeals(db, { projectId: p.id }));
  for (const p of rows) {
    const ph = phases.filter((x) => x.project_id === p.id);
    const mine = contracts.filter((c) => c.accord_id === p.accord_id);
    // The signed contract when there is one (newest signed), else the newest version with its status.
    const c = mine.find((x) => x.status === 'signed') ?? mine[0] ?? null;
    out.set(p.id, {
      project_id: p.id,
      name: p.name,
      status: p.status,
      start_date: dayOf(p.start_date),
      target_date: dayOf(p.target_date),
      phases: ph.map((x) => ({ id: x.id, name: x.name, summary: x.summary, mike_part: x.mike_part })),
      mike_parts: ph.filter((x) => x.mike_part && x.mike_part.trim() !== '').map((x) => ({ phase: x.name, text: x.mike_part as string })),
      contract: c && p.accord_id ? { status: c.status, signed_at: c.signed_at ? c.signed_at.toISOString() : null, version: c.version, deal_id: p.accord_id, deal_href: `/deals/${p.accord_id}` } : null,
      deal: p.accord ? { id: p.accord.id, name: p.accord.name, href: `/deals/${p.accord.id}` } : null,
      deal_detail: details.get(p.id) ?? null,
      sitemap: pages.filter((x) => x.project_id === p.id).map((x) => ({ id: x.id, name: x.name, page_type: x.page_type, needs_design: x.needs_design, notes: x.notes })),
    });
  }
  return out;
}

/** A project date as the calendar day it was set for (YYYY-MM-DD), or null. Dates are kept as days, never as a clock time. */
export function dayOf(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** The cards for these task ids (all must be in Triage; others are skipped), ordered: looks done first, then oldest first. */
export async function loadCards(db: Db, taskIds: string[], now: Date = new Date()): Promise<HomeTriageCard[]> {
  if (taskIds.length === 0) return [];
  const tasks = await db.task.findMany({
    where: { id: { in: taskIds }, status: 'triage', is_deleted: false },
    select: {
      id: true,
      title: true,
      tags: true,
      created_at: true,
      triage_kind: true,
      triage_rev: true,
      assignee_id: true,
      site_id: true,
      client_id: true,
      site: { select: { id: true, name: true } },
      assignee: { select: { name: true } },
      project: { select: { id: true, name: true, status: true, start_date: true, target_date: true } },
    },
  });
  const ids = tasks.map((t) => t.id);
  const openQs = await openQuestionRows(db, ids);
  const hold = pmReleaseHold();
  const sessionChanges = await sessionChangesFor(db, ids);
  const [qCounts, summaries, evidence] = await Promise.all([openQuestionCounts(db, ids), summariesFor(db, ids), evidenceFor(db, tasks.filter((t) => t.tags.includes(LOOKS_DONE_TAG)).map((t) => t.id))]);
  const setupProjectIds = Array.from(new Set(tasks.filter((t) => t.triage_kind === 'project_setup' && t.project).map((t) => t.project!.id)));
  const blocks = await projectBlocks(db, setupProjectIds);
  const changes = await recentChanges(db, ids);
  const planRows = await db.taskPlanItem.findMany({ where: { task_id: { in: ids } }, select: { task_id: true, section: true, data: true } });
  const cards: HomeTriageCard[] = tasks.map((t) => {
    const plan = planRelease({
      kind: t.triage_kind as TriageKindName | null,
      assignee_id: t.assignee_id,
      assignee_name: t.assignee?.name ?? null,
      project: t.project ? { id: t.project.id, name: t.project.name, status: t.project.status } : null,
      bast_id: BAST_USER_ID,
      site: t.site ? { id: t.site.id, name: t.site.name } : null,
      planned_tasks: planRows.filter((r) => r.task_id === t.id && r.section === 'planned_tasks' && (r.data as Record<string, unknown>).mark !== 'dropped').length,
      open_go: questionSplit(openQs.get(t.id)).go,
      open_wait: questionSplit(openQs.get(t.id)).wait,
      pm_hold: hold,
    });
    const marked = t.tags.includes(LOOKS_DONE_TAG);
    const ev = marked ? (evidence.get(t.id)?.evidence ?? '') : null;
    return {
      task_id: t.id,
      title: t.title,
      href: `/tasks/${t.id}`,
      kind: t.triage_kind,
      created_at: t.created_at.toISOString(),
      age_days: Math.max(0, Math.floor((now.getTime() - t.created_at.getTime()) / DAY_MS)),
      summary: summaries.get(t.id) ?? '',
      release_line: plan.line,
      release_details: plan.details,
      release_version: releaseVersion({
        kind: t.triage_kind,
        assignee_id: t.assignee_id,
        project_id: t.project?.id ?? null,
        project_status: t.project?.status ?? null,
        site_id: t.site_id,
        client_id: t.client_id,
        questions: openQs.get(t.id) ?? [],
        triage_rev: t.triage_rev,
      }),
      release_ready: plan.ready,
      release_block: plan.block,
      open_questions: qCounts.get(t.id) ?? 0,
      triage_rev: t.triage_rev,
      recent_changes: changes.get(t.id) ?? [],
      plan_line: planLineFor(planRows.filter((r) => r.task_id === t.id), t.project?.target_date ? dayOf(t.project.target_date) : null),
      target_start_date: dayOf(t.project?.start_date),
      target_launch_date: dayOf(t.project?.target_date),
      looks_done: ev === null ? null : { evidence: ev, links: evidenceParts(ev).filter((p) => p.href).map((p) => ({ text: p.text, href: p.href as string })) },
      project: t.triage_kind === 'project_setup' && t.project ? (blocks.get(t.project.id) ?? null) : null,
      session_changes: sessionChanges.get(t.id) ?? [],
    };
  });
  cards.sort((a, b) => Number(b.looks_done !== null) - Number(a.looks_done !== null) || a.created_at.localeCompare(b.created_at) || a.task_id.localeCompare(b.task_id));
  return cards;
}

/** Released cards (tag from-triage, no longer in Triage, not finished) that still have questions waiting for his answer. Oldest release first. */
export async function askedAfterRelease(db: Db): Promise<HomeAskedAfterRelease[]> {
  const rows = await db.task.findMany({
    where: { tags: { has: FROM_TRIAGE_TAG }, is_deleted: false, status: { in: ['not_started', 'in_progress', 'blocked', 'review'] }, questions: { some: { state: 'open' } } },
    select: { id: true, title: true, status: true, updated_at: true },
    orderBy: [{ updated_at: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  const counts = await openQuestionCounts(db, rows.map((r) => r.id));
  return rows.map((r) => ({ task_id: r.id, title: r.title, href: `/tasks/${r.id}`, status: r.status, open_questions: counts.get(r.id) ?? 0, released_at: r.updated_at.toISOString() }));
}

/** The home card's plan line from this card's plan rows (and the project's launch date, the field of record). */
function planLineFor(rows: { section: string; data: unknown }[], projectLaunch: string | null): string | null {
  if (rows.length === 0) return null;
  const d = (r: { data: unknown }) => r.data as Record<string, unknown>;
  const reqs = rows.filter((r) => r.section === 'requirements' && d(r).mark !== 'dropped').length;
  const plannedTasks = rows.filter((r) => r.section === 'planned_tasks' && d(r).mark !== 'dropped').length;
  const dates = rows.filter((r) => r.section === 'dates').map((r) => ({ label: String(d(r).label ?? ''), date: String(d(r).date ?? ''), mark: d(r).mark as string | undefined }));
  const basis = rows.find((r) => r.section === 'billing' && d(r).type === 'basis');
  return planLine({ requirements: reqs, project_launch: projectLaunch, dates, billing_kind: basis ? String(d(basis).kind) : null, planned_tasks: plannedTasks, other_items: rows.length });
}
