/**
 * Portal wait effects (portal phase B slices 1 and 2, spec section 3.5).
 *
 * Every request opens a clock so no request sits silent. All writes go through `buildWaitData`
 * and the wait store so every change writes a WaitEvent. Keys are
 * `portal:{template}:{task_id}:{intake_id}`, which makes a repeat a no-op.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { needsHuman } from '@/lib/waits/actions';
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

async function openWait(
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
      await openWait(
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
      await openWait(
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
    await openWait(
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

// ---- Slice 2: the conversation ---------------------------------------------------------------

export interface ThreadTask extends FiledTask {
  /** The contact who filed the request; the one a question is put to. */
  requested_by_contact_id?: string | null;
}

/**
 * A client wrote in the thread (or sent changes back). Spec 3.5, in order:
 *  1. Stop this contact's waits on the task, and any open "awaiting the client" clock: the
 *     question has an answer (`client_replied`).
 *  2. Staff-owned open waits on the task that are still waiting go `needs_human`: a person must
 *     read it.
 *  3. If no staff-owned wait is open at all, open `portal.client_reply`, so a message never sits
 *     unread.
 * Idempotent: the third step keys on the comment, and the first two only touch open waits.
 */
export async function onClientMessage(
  db: Db,
  task: ThreadTask,
  msg: { contact_ids: string[]; comment_id: string },
  now: Date = new Date()
): Promise<{ stopped: number; flagged: number; opened: string | null }> {
  const store = prismaSweepStore(db as PrismaClient);
  const open = await db.wait.findMany({
    where: { task_id: task.id, state: { in: [...OPEN_STATES] } },
  });

  let stopped = 0;
  for (const w of open) {
    const theirs = w.owner_contact_id != null && msg.contact_ids.includes(w.owner_contact_id);
    if (theirs || w.template_key === 'portal.awaiting_client') {
      await resolveWait(store, w, 'client_replied', {
        now,
        source: 'api',
        reason: 'The client wrote back in the portal.',
      });
      stopped++;
    }
  }

  // Staff-owned: not owned by a client contact, and not the "awaiting the client" clock.
  const staffOwned = open.filter((w) => w.owner_contact_id == null && w.template_key !== 'portal.awaiting_client');
  let flagged = 0;
  for (const w of staffOwned) {
    if (w.state !== 'waiting') continue;
    await needsHuman(store, w, {
      now,
      source: 'api',
      note: 'The client wrote in the portal thread. A person reads it and answers.',
      reason: 'A client message arrived on this request.',
    });
    flagged++;
  }

  // A staff-owned wait still open (a quote gate, a first response) already has a person on it, so a
  // reply clock would only duplicate the nag.
  let opened: string | null = null;
  if (staffOwned.length === 0) {
    const owner = task.assignee_id && task.assignee_id !== BAST_USER_ID ? task.assignee_id : null;
    const made = await openWait(
      store,
      {
        template_key: 'portal.client_reply',
        subject: task.client_title,
        owner_user_id: owner,
        idempotency_key: waitKey('client_reply', task.id, msg.comment_id),
        task_id: task.id,
        client_id: task.client_id,
        project_id: task.project_id,
        charter_id: task.charter_id,
        site_id: task.site_id,
      },
      now
    );
    opened = made.created ? made.id : null;
  }
  return { stopped, flagged, opened };
}

/**
 * Staff made a reply visible to the client. Resolves the reply and first-response clocks as
 * `answered`. A reply that is a question opens `portal.awaiting_client` (five business days, then
 * a task to the liaison), owned by the requester.
 */
export async function onStaffReply(
  db: Db,
  task: ThreadTask,
  comment: { id: string; client_question: boolean },
  now: Date = new Date()
): Promise<{ resolved: number; awaiting: string | null }> {
  const store = prismaSweepStore(db as PrismaClient);
  const open = await db.wait.findMany({
    where: {
      task_id: task.id,
      template_key: { in: ['portal.client_reply', 'portal.first_response'] },
      state: { in: [...OPEN_STATES] },
    },
  });
  for (const w of open) {
    await resolveWait(store, w, 'answered', { now, source: 'api', reason: 'Staff replied to the client in the portal.' });
  }

  let awaiting: string | null = null;
  if (comment.client_question) {
    const already = await db.wait.findMany({
      where: { task_id: task.id, template_key: 'portal.awaiting_client', state: { in: [...OPEN_STATES] } },
      select: { id: true },
    });
    if (already.length === 0) {
      const made = await openWait(
        store,
        {
          template_key: 'portal.awaiting_client',
          subject: task.client_title,
          owner_contact_id: task.requested_by_contact_id ?? null,
          idempotency_key: waitKey('awaiting_client', task.id, comment.id),
          task_id: task.id,
          client_id: task.client_id,
          project_id: task.project_id,
          charter_id: task.charter_id,
          site_id: task.site_id,
        },
        now
      );
      awaiting = made.created ? made.id : null;
    }
  }
  return { resolved: open.length, awaiting };
}

// ---- Phase C: the chat handed a conversation to a person --------------------------------------

/**
 * The assistant handed a conversation to a person (spec 8): open `portal.client_reply` (assignee
 * or liaison, 1 business day, escalates). Keyed on the handoff note so a repeat is a no-op.
 */
export async function onChatHandoff(
  db: Db,
  task: FiledTask,
  ref: string,
  now: Date = new Date()
): Promise<{ id: string; created: boolean }> {
  const store = prismaSweepStore(db as PrismaClient);
  const owner = task.assignee_id && task.assignee_id !== BAST_USER_ID ? task.assignee_id : null;
  const made = await openWait(
    store,
    {
      template_key: 'portal.client_reply',
      subject: task.client_title,
      owner_user_id: owner,
      idempotency_key: waitKey('client_reply', task.id, ref),
      task_id: task.id,
      client_id: task.client_id,
      project_id: task.project_id,
      charter_id: task.charter_id,
      site_id: task.site_id,
    },
    now
  );
  return { id: made.id, created: made.created };
}
