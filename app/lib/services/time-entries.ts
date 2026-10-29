/**
 * Time entry start/stop logic shared by the manual Timekeeper routes (`/api/time-entries/start`,
 * `/api/time-entries/:id/stop`) and the Designer Portal automatic timer (lib/design/timer.ts, design D10).
 * Extracted from the routes with identical behavior; the design timer passes `touchTask: false`.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export type TimeEntryDb = PrismaClient | Prisma.TransactionClient;

const ENTRY_INCLUDE = {
  task: { select: { id: true, title: true } },
  project: { select: { id: true, name: true } },
} as const;

/** Whole minutes, rounded up: ceil(floor(seconds) / 60). Matches the original routes. */
export function durationMinutes(startedAt: Date, endedAt: Date): number {
  const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
  return Math.ceil(durationSeconds / 60);
}

export interface StartRunningEntryInput {
  userId: string;
  taskId: string;
  projectId?: string | null;
  /** Omitted: the column default (null). */
  description?: string;
  /** Omitted: the column default (true). */
  isBillable?: boolean;
  /** Manual start: set the task in_progress, is_focus, and auto-assign it. The design timer passes false. */
  touchTask: boolean;
}

/** Stops every running entry of the user, then creates a new running entry. Returns it with task and project. */
export async function startRunningEntry(input: StartRunningEntryInput, db: TimeEntryDb = prisma) {
  const { userId, taskId, description, isBillable, touchTask } = input;

  // Stop any existing running timer for this user
  await stopRunningEntry({ userId }, db);

  // Get task for project_id if not provided
  let resolvedProjectId = input.projectId;
  if (!resolvedProjectId) {
    const task = await db.task.findUnique({ where: { id: taskId }, select: { project_id: true } });
    resolvedProjectId = task?.project_id;
  }

  const timer = await db.timeEntry.create({
    data: {
      task_id: taskId,
      project_id: resolvedProjectId,
      user_id: userId,
      started_at: new Date(),
      is_running: true,
      duration: 0,
      ...(description !== undefined ? { description } : {}),
      ...(isBillable !== undefined ? { is_billable: isBillable } : {}),
    },
    include: ENTRY_INCLUDE,
  });

  if (touchTask) {
    // Set to in_progress if not_started, and always set is_focus
    await db.task.updateMany({
      where: { id: taskId, status: 'not_started' },
      data: { status: 'in_progress', started_at: new Date(), is_focus: true },
    });
    // Also set is_focus=true for tasks already in progress
    await db.task.updateMany({
      where: { id: taskId, status: { not: 'not_started' } },
      data: { is_focus: true },
    });
    // Auto-assign task to current user if unassigned
    await db.task.updateMany({
      where: { id: taskId, assignee_id: null },
      data: { assignee_id: userId },
    });
  }

  return timer;
}

export type StopRunningEntryInput = { entryId: string; endedAt?: Date } | { userId: string; endedAt?: Date };

/**
 * Stops one entry (by id; returns it with task and project) or every running entry of a user (returns the count).
 * `endedAt` defaults to now. Callers validate ownership and the ended_at-after-started_at rule.
 */
export async function stopRunningEntry(input: { entryId: string; endedAt?: Date }, db?: TimeEntryDb): Promise<Awaited<ReturnType<typeof stopOne>>>;
export async function stopRunningEntry(input: { userId: string; endedAt?: Date }, db?: TimeEntryDb): Promise<number>;
export async function stopRunningEntry(input: StopRunningEntryInput, db: TimeEntryDb = prisma): Promise<unknown> {
  if ('entryId' in input) {
    const entry = await db.timeEntry.findUnique({ where: { id: input.entryId } });
    if (!entry) return null;
    return stopOne(db, entry.id, entry.started_at, input.endedAt ?? new Date());
  }
  const existing = await db.timeEntry.findMany({ where: { user_id: input.userId, is_running: true } });
  for (const e of existing) {
    const endedAt = input.endedAt ?? new Date();
    await db.timeEntry.update({
      where: { id: e.id },
      data: { is_running: false, ended_at: endedAt, duration: durationMinutes(e.started_at, endedAt) },
    });
  }
  return existing.length;
}

function stopOne(db: TimeEntryDb, id: string, startedAt: Date, endedAt: Date) {
  return db.timeEntry.update({
    where: { id },
    data: { is_running: false, ended_at: endedAt, duration: durationMinutes(startedAt, endedAt) },
    include: ENTRY_INCLUDE,
  });
}
