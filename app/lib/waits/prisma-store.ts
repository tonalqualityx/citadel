/**
 * Prisma implementation of the sweeper's store (lib/waits/sweeper.ts). Kept thin: every rule
 * lives in the sweeper, which is tested against memory.
 */

import { Prisma, type PrismaClient, type WaitKind } from '@prisma/client';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import type { GuardValues } from './templates';
import type { EventsStore, EventTarget } from './events';
import { OPEN_STATES, type SweepStore, type TaskSpec, type WaitData, type WaitEventInput, type WaitRow } from './sweeper';

export function prismaSweepStore(db: PrismaClient): SweepStore & EventsStore {
  return {
    listPausedDue(now) {
      return db.wait.findMany({ where: { state: 'paused', paused_until: { lte: now } } });
    },
    listBlockedBySwitch() {
      return db.wait.findMany({ where: { state: 'blocked_by_switch', switch_key: { not: null } } });
    },
    listOpen() {
      return db.wait.findMany({ where: { state: { in: [...OPEN_STATES] } }, orderBy: { due_at: 'asc' } });
    },
    async claim(id, now, staleBefore) {
      const res = await db.wait.updateMany({
        where: {
          id,
          state: 'waiting',
          fired_at: null,
          OR: [{ claimed_at: null }, { claimed_at: { lt: staleBefore } }],
        },
        data: { claimed_at: now },
      });
      if (res.count !== 1) return null;
      return db.wait.findUnique({ where: { id } });
    },
    update(id, data) {
      return db.wait.update({ where: { id }, data: data as Prisma.WaitUncheckedUpdateInput });
    },
    async insertIdempotent(data: WaitData) {
      const create = data as unknown as Prisma.WaitUncheckedCreateInput;
      if (data.idempotency_key) {
        const existing = await db.wait.findUnique({ where: { idempotency_key: data.idempotency_key } });
        if (existing) return { wait: existing, created: false };
      }
      try {
        return { wait: await db.wait.create({ data: create }), created: true };
      } catch (e) {
        // Lost a race on the unique key: the other writer's row is the answer.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && data.idempotency_key) {
          const existing = await db.wait.findUnique({ where: { idempotency_key: data.idempotency_key } });
          if (existing) return { wait: existing, created: false };
        }
        throw e;
      }
    },
    async addEvent(e: WaitEventInput) {
      await db.waitEvent.create({
        data: {
          wait_id: e.wait_id,
          kind: e.kind,
          from_due_at: e.from_due_at ?? null,
          to_due_at: e.to_due_at ?? null,
          from_state: e.from_state ?? null,
          to_state: e.to_state ?? null,
          reason: e.reason ?? null,
          source: e.source,
          actor_user_id: e.actor_user_id ?? null,
          email_message_id: e.email_message_id ?? null,
          event_id: e.event_id ?? null,
        },
      });
    },
    countEvents(waitId, kind) {
      return db.waitEvent.count({ where: { wait_id: waitId, kind } });
    },
    async subjectState(w: WaitRow) {
      if (w.task_id) {
        const t = await db.task.findUnique({ where: { id: w.task_id }, select: { status: true, is_deleted: true } });
        if (!t || t.is_deleted || t.status === 'abandoned') return 'gone';
        if (t.status === 'done') return 'task_done';
      }
      if (w.project_id) {
        const p = await db.project.findUnique({ where: { id: w.project_id }, select: { status: true } });
        if (!p || p.status === 'cancelled') return 'gone';
      }
      if (w.accord_id) {
        const a = await db.accord.findUnique({ where: { id: w.accord_id }, select: { status: true, is_deleted: true } });
        if (!a || a.is_deleted || a.status === 'lost') return 'gone';
      }
      if (w.charter_id) {
        const c = await db.charter.findUnique({ where: { id: w.charter_id }, select: { status: true, is_deleted: true } });
        if (!c || c.is_deleted || c.status === 'cancelled') return 'gone';
      }
      return null;
    },
    async preconditionMet(w, precondition) {
      if (precondition === 'no_charter') {
        if (!w.client_id) return true;
        const n = await db.charter.count({
          where: { client_id: w.client_id, is_deleted: false, status: { in: ['active', 'paused'] } },
        });
        return n === 0;
      }
      // no_plan: plans are not modelled yet (phase 3); never suppress the task.
      return true;
    },
    async createTask(spec: TaskSpec) {
      const t = await db.task.create({
        data: {
          title: spec.title.slice(0, 500),
          description: spec.description,
          assignee_id: spec.assignee_id,
          client_id: spec.client_id,
          project_id: spec.project_id,
          site_id: spec.site_id,
          charter_id: spec.charter_id,
          accord_id: spec.accord_id,
          due_date: spec.due_date,
          tags: spec.tags,
          created_by_id: BAST_USER_ID,
        },
        select: { id: true },
      });
      return t.id;
    },
    async guardValues(): Promise<GuardValues> {
      // review_clock_on and silent_acceptance_live are Client columns from phase 3. Until then
      // the defaults in templates.ts apply to every client.
      return {};
    },
    async eventSeen(eventId: string) {
      const hit = await db.waitEvent.findFirst({ where: { event_id: { startsWith: `${eventId}:` } }, select: { id: true } });
      return !!hit;
    },
    findTargets(t: EventTarget) {
      return db.wait.findMany({
        where: {
          state: { in: [...OPEN_STATES] },
          ...(t.wait_id ? { id: t.wait_id } : {}),
          ...(t.project_id ? { project_id: t.project_id } : {}),
          ...(t.accord_id ? { accord_id: t.accord_id } : {}),
          ...(t.charter_id ? { charter_id: t.charter_id } : {}),
          ...(t.site_id ? { site_id: t.site_id } : {}),
          ...(t.client_id ? { client_id: t.client_id } : {}),
          ...(t.contact_id ? { owner_contact_id: t.contact_id } : {}),
          ...(t.thread_id ? { email_thread_id: t.thread_id } : {}),
          ...(t.wait_kinds?.length ? { kind: { in: t.wait_kinds as WaitKind[] } } : {}),
          ...(t.template_key ? { template_key: t.template_key } : {}),
        },
        take: 200,
      });
    },
    countAutoExtensions(waitId: string) {
      return db.waitEvent.count({ where: { wait_id: waitId, kind: 'extended', reason: { startsWith: 'auto-reply' } } });
    },
  };
}
