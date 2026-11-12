/**
 * Home Slice 9a: "Track it", his tap on a card for work that is not in Citadel. One transaction.
 *
 * The owner's rule (2026-11-11): anything that is a multi-step item is made into a project. Tasks may be added to an existing live project;
 * a finished project is never reused. The card offers only the filing buttons that rule allows, and this door enforces the same choices:
 *   placement 'project'      only when the card named a live project of this client (re-read now).
 *   placement 'new_project'  a new live project (status in_progress), unless the work is a single finished one-off.
 *   placement 'none'         only a single finished one-off with no next step.
 * Writes: the project when new (no billing, budget or rate field), the done task (completed_at = the send time of his email), the
 * next-step task, the later tasks (each blocked by the next-step task), and ONE TimeEntry only when minutes are chosen. No column is added.
 */
import type { PrismaClient } from '@prisma/client';
import { BAST_USER_ID } from '@/lib/bast-chat/gate-mirror';
import { appendHomeAction } from '../state';
import { dayWords, plainLine, trackToast } from './copy';
import { ReconcileError } from './errors';
import { clampMinutes } from './estimate';
import { loadOpenCard, UNDO_HOURS, type TapOpts } from './apply';
import { hasMoreSteps, isLive } from './placement';
import type { ReconcileRecord } from './records';
import { createEstimatedEntry } from './time';
import { closeAsksForTask } from '@/lib/work/ask-closure'; // Work stage A: the one closure of a finished task's emails
import { checkTracked, trackedSentence } from '@/lib/work/guard'; // Work stage D: never a second to-do for work something already carries
import { emailSourcesFor } from '@/lib/work/tracked';
import type { HomeActResponse } from '../types';

export type TrackPlacement = 'project' | 'new_project' | 'none';

export interface TrackReq {
  placement: TrackPlacement;
  minutes: number | null;
  billable: boolean;
  /** Work stage D: the owner's own "track it anyway" after he heard the conversation is already attached to open work. */
  create_anyway?: boolean;
}

interface TrackPlan {
  client_id: string;
  client_name: string;
  site_id: string | null;
  placement: { kind: 'add' | 'ask' | 'new' | 'loose'; project_id: string | null };
  title: string;
  done_title: string;
  next_step: string;
  later: string[];
  minutes: number;
  thread_id: string;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').slice(0, max);
const strs = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.slice(0, max)).slice(0, n) : []);

function readPlan(p: Record<string, unknown>): TrackPlan | null {
  if (p.type !== 'track' || typeof p.client_id !== 'string') return null;
  const pl = (p.placement && typeof p.placement === 'object' ? p.placement : {}) as Record<string, unknown>;
  const kind = pl.kind === 'add' || pl.kind === 'ask' || pl.kind === 'new' || pl.kind === 'loose' ? pl.kind : 'new';
  return {
    client_id: p.client_id,
    client_name: str(p.client_name, 255),
    site_id: typeof p.site_id === 'string' ? p.site_id : null,
    placement: { kind, project_id: typeof pl.project_id === 'string' ? pl.project_id : null },
    title: str(p.title, 120),
    done_title: str(p.done_title, 120),
    next_step: str(p.next_step, 200),
    later: strs(p.later, 5, 120),
    minutes: typeof p.minutes === 'number' ? p.minutes : 0,
    thread_id: str(p.thread_id, 255),
  };
}

const paragraphs = (lines: (string | null)[]): string => lines.filter((l): l is string => !!l && l.trim() !== '').join('\n');

export async function trackIt(db: PrismaClient, userId: string, itemKey: string, req: TrackReq, o: TapOpts): Promise<HomeActResponse> {
  const card = await loadOpenCard(db, userId, itemKey, o.now);
  if (card.kind !== 'track') throw new ReconcileError('not_found');
  const plan = readPlan(card.plan);
  if (!plan) throw new ReconcileError('changed_since');
  const multi = hasMoreSteps({ title: plan.title, done_title: plan.done_title, next_step: plan.next_step, later: plan.later });

  // The choice must be one the card offered.
  if (req.placement === 'none' && (plan.placement.kind !== 'loose' || multi)) throw new ReconcileError('bad_choice');
  if (req.placement === 'new_project' && plan.placement.kind === 'loose') throw new ReconcileError('bad_choice');
  if (req.placement === 'project' && !(plan.placement.kind === 'add' || plan.placement.kind === 'ask')) throw new ReconcileError('bad_choice');
  if (req.placement === 'project' && !plan.placement.project_id) throw new ReconcileError('bad_choice');

  // Work stage D: the conversation behind this card may have been attached to open work since the card was made. Then nothing is created.
  if (req.create_anyway !== true && plan.thread_id) {
    const sources = await emailSourcesFor(db, { thread_id: plan.thread_id });
    const tracked = await checkTracked(db, sources, {});
    if (tracked) throw new ReconcileError('already_tracked', trackedSentence(tracked));
  }

  const minutes = req.minutes && req.minutes > 0 ? clampMinutes(req.minutes) : 0;
  const sent = card.quote_at ?? o.now;
  const link = card.link;

  return db.$transaction(
    async (txc) => {
      const tx = txc as unknown as PrismaClient;
      const client = await tx.client.findUnique({ where: { id: plan.client_id }, select: { id: true, name: true } });
      if (!client) throw new ReconcileError('changed_since');

      // The project: an existing live one of this client (re-read now), or a new live one. Never a finished one.
      let projectId: string | null = null;
      let projectMade = false;
      if (req.placement === 'project') {
        const p = await tx.project.findFirst({ where: { id: plan.placement.project_id as string, client_id: client.id, is_deleted: false }, select: { id: true, status: true } });
        if (!p || !isLive(p)) throw new ReconcileError('changed_since', 'That project is not live any more. Pick again.');
        projectId = p.id;
      } else if (req.placement === 'new_project') {
        const made = await tx.project.create({
          data: {
            name: plainLine(plan.title, 120) || 'Work from your email',
            description: paragraphs([`Started from your email of ${dayWords(sent, o.timezone)}.`, link ? `Open the email: ${link}` : null]),
            status: 'in_progress',
            type: 'project',
            client_id: client.id,
            site_id: plan.site_id,
            created_by_id: BAST_USER_ID,
            next_step_text: plan.next_step || null,
            next_step_owner_id: userId,
            next_step_source: 'bast',
            next_step_at: o.now,
          },
          select: { id: true },
        });
        projectId = made.id;
        projectMade = true;
      }

      const common = { assignee_id: userId, client_id: client.id, project_id: projectId, site_id: plan.site_id, tags: ['from-sent-mail'], created_by_id: BAST_USER_ID, origin_url: link };
      const done = await tx.task.create({
        data: {
          ...common,
          title: plainLine(plan.done_title, 400),
          description: paragraphs([
            plainLine(plan.done_title, 300),
            card.quote ? `His words: "${card.quote}"` : null,
            link ? `Open the email: ${link}` : null,
            `Logged after the fact from your email of ${dayWords(sent, o.timezone)}.`,
          ]),
          status: 'done',
          completed_at: sent,
          estimated_minutes: minutes > 0 ? minutes : null,
        },
        select: { id: true },
      });
      await closeAsksForTask(tx, done.id, 'done'); // Work stage A: a task created finished closes any email linked to it (none yet; the one rule stays in one place)
      const taskIds = [done.id];
      let next: { id: string } | null = null;
      if (plan.next_step.trim() !== '') {
        next = await tx.task.create({
          data: { ...common, title: plainLine(plan.next_step, 400), description: paragraphs([link ? `Open the email: ${link}` : null]), status: 'not_started' },
          select: { id: true },
        });
        taskIds.push(next.id);
        for (const l of plan.later) {
          const t = await tx.task.create({
            data: {
              ...common,
              title: plainLine(l, 400),
              description: paragraphs([link ? `Open the email: ${link}` : null]),
              // Blocked by the next step, so it stays out of view until that is done (the system's own state for a task with an open blocker).
              status: 'blocked',
              blocked_by: { connect: [{ id: next.id }] },
            },
            select: { id: true },
          });
          taskIds.push(t.id);
        }
      }

      let entry: { id: string; started_at: Date; duration: number } | null = null;
      if (minutes > 0) {
        entry = await createEstimatedEntry(tx, { user_id: userId, task_id: done.id, project_id: projectId, ended_at: sent, minutes, billable: req.billable, sent, timezone: o.timezone });
      }

      const claimed = await tx.homeReconcileChange.updateMany({ where: { id: card.id, user_id: userId, state: 'open' }, data: { state: 'applied', resolved_at: o.now } });
      if (claimed.count !== 1) throw new ReconcileError('card_gone');
      const rec: ReconcileRecord = {
        kind: 'track',
        change_id: card.id,
        project_id: projectId,
        project_made: projectMade,
        task_ids: taskIds,
        time_entry_id: entry?.id ?? null,
        time_started_at: entry ? entry.started_at.toISOString() : null,
        time_duration: entry ? entry.duration : null,
      };
      const undoUntil = new Date(o.now.getTime() + UNDO_HOURS * 3600 * 1000);
      const row = await appendHomeAction(tx, userId, { item_key: itemKey, action: 'reconcile_track', before: { states: [], reconcile: rec }, after: { states: [], reconcile: rec }, undo_until: undoUntil });
      await tx.homeReconcileChange.update({
        where: { id: card.id },
        data: { home_action_id: row.id, time_entry_id: entry?.id ?? null, created_ids: { project_id: projectId, task_ids: taskIds } },
      });
      return { ok: true as const, action_id: row.id, undo_until: undoUntil.toISOString(), item_key: itemKey, message: trackToast(taskIds.length, entry?.duration ?? null, client.name) };
    },
    { timeout: 30_000, maxWait: 10_000 }
  );
}
