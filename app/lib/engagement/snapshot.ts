/**
 * The project snapshot (Dox, PLAN-dox-office-manager slice 1): one read of what a project sweep needs.
 *
 *   project      status, type, start and target dates, the ordering-only flag, plan_folder
 *   phases       the project's phases in order
 *   tasks        every OPEN task (not_started, in_progress, review, blocked; never Triage, done or abandoned) with assignee, function, tags, due
 *                date, status, last activity, its blockers (each marked satisfied or not by the same rule the dependency sweep uses), and whether a
 *                live session is linked (the work-sessions state, batched: lib/work/state.ts liveSessionTaskIds)
 *   waits        open waits on the project or on one of its tasks, with the owner and the due time
 *   questions    open card questions on the project's tasks and its Triage cards
 *
 * Read only. Nothing here writes, and nothing leaves the owner's session or the Dox lane (the routes check).
 */
import type { PrismaClient } from '@prisma/client';
import { isBlockerSatisfied } from '@/lib/services/dependencies';
import { resolveWaitOwner, type WaitRow } from '@/lib/waits/sweeper';
import { prismaOwnerLookups } from '@/lib/waits/owner';
import { liveSessionTaskIds } from '@/lib/work/state';
import { OPEN_TASK_STATUSES } from './brief';

export const SNAPSHOT_TASK_CAP = 600;

export interface SnapshotBlocker {
  id: string;
  title: string;
  status: string;
  assignee_id: string | null;
  satisfied: boolean;
}

export interface SnapshotTask {
  id: string;
  title: string;
  status: string;
  assignee: { id: string; name: string } | null;
  function: { id: string; name: string } | null;
  phase_id: string | null;
  tags: string[];
  due_date: string | null;
  /** The newest of the task's own update and its newest comment (ISO). */
  last_activity_at: string;
  blockers: SnapshotBlocker[];
  /** True when every blocker is satisfied (or there are none). */
  blockers_satisfied: boolean;
  live_session: boolean;
}

export interface SnapshotWait {
  id: string;
  title: string;
  template_key: string;
  state: string;
  task_id: string | null;
  owner: { kind: 'user' | 'function' | 'contact' | 'mike'; user_id: string | null; name: string | null };
  due_at: string;
  overdue: boolean;
}

export interface SnapshotQuestion {
  id: string;
  task_id: string;
  task_title: string;
  question: string;
  cause_key: string | null;
  asked_by_lane: string | null;
  created_at: string;
}

export interface ProjectSnapshot {
  generated_at: string;
  project: {
    id: string;
    name: string;
    status: string;
    type: string;
    start_date: string | null;
    target_date: string | null;
    dependencies_ordering_only: boolean;
    plan_folder: string | null;
  };
  phases: { id: string; name: string; sort_order: number }[];
  tasks: SnapshotTask[];
  /** True when more than SNAPSHOT_TASK_CAP tasks were open and the list was cut. */
  tasks_truncated: boolean;
  waits: SnapshotWait[];
  questions: SnapshotQuestion[];
}

const OPEN_WAIT_STATES = ['waiting', 'needs_human', 'paused', 'blocked_by_switch'] as const;

export async function buildProjectSnapshot(db: PrismaClient, projectId: string, now: Date = new Date()): Promise<ProjectSnapshot | null> {
  const project = await db.project.findFirst({
    where: { id: projectId, is_deleted: false },
    select: { id: true, name: true, status: true, type: true, start_date: true, target_date: true, dependencies_ordering_only: true, plan_folder: true },
  });
  if (!project) return null;

  const [phases, rows] = await Promise.all([
    db.projectPhase.findMany({ where: { project_id: projectId }, orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }], select: { id: true, name: true, sort_order: true } }),
    db.task.findMany({
      where: { project_id: projectId, is_deleted: false, status: { in: [...OPEN_TASK_STATUSES] } },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: SNAPSHOT_TASK_CAP + 1,
      select: {
        id: true, title: true, status: true, tags: true, due_date: true, updated_at: true, phase_id: true, project_id: true,
        assignee: { select: { id: true, name: true } },
        function: { select: { id: true, name: true } },
        blocked_by: {
          where: { is_deleted: false },
          select: { id: true, title: true, status: true, approved: true, assignee_id: true, project: { select: { dependencies_ordering_only: true } } },
        },
      },
    }),
  ]);
  const truncated = rows.length > SNAPSHOT_TASK_CAP;
  const tasks = truncated ? rows.slice(0, SNAPSHOT_TASK_CAP) : rows;
  const taskIds = tasks.map((t) => t.id);

  const [lastComments, live, waitRows, questionRows] = await Promise.all([
    taskIds.length
      ? db.comment.groupBy({ by: ['task_id'], where: { task_id: { in: taskIds }, is_deleted: false }, _max: { created_at: true } })
      : Promise.resolve([] as { task_id: string; _max: { created_at: Date | null } }[]),
    liveSessionTaskIds(db, tasks.map((t) => ({ id: t.id, project_id: t.project_id }))),
    db.wait.findMany({
      where: { state: { in: [...OPEN_WAIT_STATES] }, OR: [{ project_id: projectId }, { task: { project_id: projectId } }] },
      orderBy: { due_at: 'asc' },
      take: 200,
    }),
    db.taskQuestion.findMany({
      where: { state: 'open', task: { project_id: projectId, is_deleted: false } },
      orderBy: { created_at: 'asc' },
      take: 200,
      select: { id: true, task_id: true, question: true, cause_key: true, asked_by_lane: true, created_at: true, task: { select: { title: true } } },
    }),
  ]);
  const lastBy = new Map(lastComments.map((c) => [c.task_id, c._max.created_at]));

  const lookups = prismaOwnerLookups(db as unknown as Parameters<typeof prismaOwnerLookups>[0]);
  const names = await ownerNames(db, waitRows);
  const waits: SnapshotWait[] = [];
  for (const w of waitRows) {
    const resolved = await resolveWaitOwner(w as unknown as WaitRow, lookups);
    const kind = w.owner_contact_id ? 'contact' : w.owner_user_id ? 'user' : w.owner_function_id ? 'function' : 'mike';
    waits.push({
      id: w.id,
      title: w.title,
      template_key: w.template_key,
      state: w.state,
      task_id: w.task_id,
      owner: { kind, user_id: resolved.user_id ?? null, name: names.get(w.id) ?? (kind === 'mike' ? 'Mike' : null) },
      due_at: w.due_at.toISOString(),
      overdue: w.due_at.getTime() < now.getTime(),
    });
  }

  return {
    generated_at: now.toISOString(),
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      type: project.type,
      start_date: project.start_date ? project.start_date.toISOString() : null,
      target_date: project.target_date ? project.target_date.toISOString() : null,
      dependencies_ordering_only: project.dependencies_ordering_only,
      plan_folder: project.plan_folder,
    },
    phases,
    tasks: tasks.map((t) => {
      const blockers = t.blocked_by.map((b) => ({
        id: b.id,
        title: b.title,
        status: b.status,
        assignee_id: b.assignee_id,
        satisfied: isBlockerSatisfied({ status: b.status, approved: b.approved, project: b.project }),
      }));
      const last = lastBy.get(t.id);
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        assignee: t.assignee,
        function: t.function,
        phase_id: t.phase_id,
        tags: t.tags,
        due_date: t.due_date ? t.due_date.toISOString() : null,
        last_activity_at: (last && last.getTime() > t.updated_at.getTime() ? last : t.updated_at).toISOString(),
        blockers: blockers.map(({ id, title, status, assignee_id, satisfied }) => ({ id, title, status, assignee_id, satisfied })),
        blockers_satisfied: blockers.every((b) => b.satisfied),
        live_session: live.has(t.id),
      };
    }),
    tasks_truncated: truncated,
    waits,
    questions: questionRows.map((q) => ({
      id: q.id,
      task_id: q.task_id,
      task_title: q.task.title,
      question: q.question,
      cause_key: q.cause_key,
      asked_by_lane: q.asked_by_lane,
      created_at: q.created_at.toISOString(),
    })),
  };
}

/** A readable owner name per wait: the contact, the user or the function it points at. */
async function ownerNames(db: PrismaClient, waits: { id: string; owner_user_id: string | null; owner_function_id: string | null; owner_contact_id: string | null }[]): Promise<Map<string, string>> {
  const userIds = [...new Set(waits.flatMap((w) => (w.owner_user_id ? [w.owner_user_id] : [])))];
  const fnIds = [...new Set(waits.flatMap((w) => (w.owner_function_id ? [w.owner_function_id] : [])))];
  const contactIds = [...new Set(waits.flatMap((w) => (w.owner_contact_id ? [w.owner_contact_id] : [])))];
  const [users, fns, contacts] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    fnIds.length ? db.function.findMany({ where: { id: { in: fnIds } }, select: { id: true, name: true } }) : [],
    contactIds.length ? db.clientContact.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } }) : [],
  ]);
  const u = new Map(users.map((x) => [x.id, x.name]));
  const f = new Map(fns.map((x) => [x.id, x.name]));
  const c = new Map(contacts.map((x) => [x.id, x.name]));
  const out = new Map<string, string>();
  for (const w of waits) {
    const n = (w.owner_contact_id && c.get(w.owner_contact_id)) || (w.owner_user_id && u.get(w.owner_user_id)) || (w.owner_function_id && f.get(w.owner_function_id)) || null;
    if (n) out.set(w.id, n);
  }
  return out;
}
