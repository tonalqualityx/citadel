/**
 * Portal wait effects (portal phase B slice 1, spec section 3.5).
 *
 * Every request opens a clock so no request sits silent. All writes go through `buildWaitData`
 * and the wait store so every change writes a WaitEvent. Keys are
 * `portal:{template}:{task_id}:{intake_id}`, which makes a repeat a no-op.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { OPEN_STATES, resolveWait, type SweepStore } from '@/lib/waits/sweeper';
import { buildWaitData } from '@/lib/waits/templates';
import { isPortalTaskAnswered } from '@/lib/waits/portal-precondition';

type Db = PrismaClient | Prisma.TransactionClient;

export interface FiledTask {
  id: string;
  client_title: string;
  assignee_id: string | null;
  client_id: string | null;
  project_id: string | null;
  charter_id: string | null;
  site_id: string | null;
}

export interface FiledEffects {
  intake_id: string;
  /** Files tagged quote: Mike rules on scope. */
  quote: boolean;
  /** An emergency whose daily limit has not been reached. */
  emergency: boolean;
}

export const waitKey = (template: string, taskId: string, ref: string) => `portal:${template}:${taskId}:${ref}`;

async function open(
  store: SweepStore,
  input: Parameters<typeof buildWaitData>[0],
  now: Date
): Promise<{ id: string; template_key: string; created: boolean }> {
  const data = buildWaitData({ ...input, started_at: now, created_by_automation: 'portal-intake' });
  const { wait, created } = await store.insertIdempotent(data);
  if (created) {
    await store.addEvent({
      wait_id: wait.id,
      kind: 'created',
      to_state: 'waiting',
      to_due_at: wait.due_at,
      reason: `Opened from ${wait.template_key} by the portal.`,
      source: 'placement',
    });
  }
  return { id: wait.id, template_key: wait.template_key, created };
}

/**
 * A request was filed. In scope: a first-response clock on the assignee (the `bast` role when
 * Bast). A quote: Mike rules on scope. An emergency: a two-hour clock on Mike. Returns what opened.
 */
export async function onRequestFiled(
  db: Db,
  task: FiledTask,
  effects: FiledEffects,
  now: Date = new Date()
): Promise<Array<{ id: string; template_key: string; created: boolean }>> {
  const store = prismaSweepStore(db as PrismaClient);
  const links = {
    task_id: task.id,
    client_id: task.client_id,
    project_id: task.project_id,
    charter_id: task.charter_id,
    site_id: task.site_id,
  };
  const subject = task.client_title;
  const opened: Array<{ id: string; template_key: string; created: boolean }> = [];

  if (effects.emergency) {
    opened.push(
      await open(
        store,
        {
          template_key: 'portal.emergency',
          subject,
          owner_user_id: MIKE_USER_ID,
          idempotency_key: waitKey('emergency', task.id, effects.intake_id),
          ...links,
        },
        now
      )
    );
    return opened;
  }

  if (effects.quote) {
    opened.push(
      await open(
        store,
        {
          template_key: 'build.gate_mike',
          title: `Rule on scope and send a quote: ${subject}`.slice(0, 300),
          subject,
          idempotency_key: waitKey('gate_mike', task.id, effects.intake_id),
          ...links,
        },
        now
      )
    );
    return opened;
  }

  // Bast owns the clock by role; a person (including Mike, for a marketing question with
  // nowhere else to go) owns it by name.
  const owner = task.assignee_id && task.assignee_id !== BAST_USER_ID ? task.assignee_id : null;
  opened.push(
    await open(
      store,
      {
        template_key: 'portal.first_response',
        subject,
        owner_user_id: owner,
        idempotency_key: waitKey('first_response', task.id, effects.intake_id),
        ...links,
      },
      now
    )
  );
  return opened;
}

/**
 * A task moved: it left not_started, or it is staged. Resolve its open first-response clock as
 * answered. Returns the number resolved. Safe to call on every task update.
 */
export async function onTaskProgress(
  db: Db,
  task: { id: string; status: string; staging_preview_url?: string | null },
  now: Date = new Date()
): Promise<number> {
  if (!isPortalTaskAnswered(task)) return 0;
  const open = await db.wait.findMany({
    where: { task_id: task.id, template_key: 'portal.first_response', state: { in: [...OPEN_STATES] } },
  });
  if (open.length === 0) return 0;
  const store = prismaSweepStore(db as PrismaClient);
  for (const w of open) {
    await resolveWait(store, w, 'answered', {
      now,
      source: 'api',
      reason: 'The task moved, so the client has an answer.',
    });
  }
  return open.length;
}
