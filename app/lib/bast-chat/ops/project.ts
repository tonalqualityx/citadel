/**
 * Bast chat v2, op `project`: a project's status (plan 2.1; PATCH /api/projects/:id with only a status).
 *
 * Same write as the route (no transition check there either): status, and completed_date set on done and cleared on
 * leaving done. Compare-and-set on the status read. The reach check judges a move OUT of quote, queue, suspended or
 * cancelled into a visible status as a client show (the portal hides those four): that is a tap, nothing written.
 * The worker's queue has no project filter, so a status never starts Bast. Undo puts the status and completed_date
 * back, and an Undo that would make a hidden project visible is a tap too.
 *
 * Record: target_id is the project id; before and after hold `{project_id, status, completed_date}`.
 */
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { opSummary, shortTitle, type OpContext, type PreparedOp } from '../actions';
import { checkOp, PROJECT_STATUSES, type ReachOrigin } from '../worker-reach';
import { lockScope } from '../task-locks';
import type { OpDef, OpDb, OpRun } from './index';

const STATUS = z.enum(PROJECT_STATUSES as [string, ...string[]]);
const inputSchema = z.object({ project_id: z.string().uuid(), status: STATUS }).strict();
export type ProjectInput = z.infer<typeof inputSchema>;
const expectSchema = z.object({ status: STATUS }).strict();
const snapSchema = z.object({ project_id: z.string().uuid(), status: STATUS, completed_date: z.string().nullable() }).strict();

type Row = { id: string; name: string; status: string; completed_date: Date | null };

async function load(db: OpDb, id: string): Promise<Row> {
  const p = await db.project.findFirst({ where: { id, is_deleted: false }, select: { id: true, name: true, status: true, completed_date: true } });
  if (!p) throw new ApiError('That project does not exist.', 404, 'project_missing');
  return p as Row;
}

async function prepare(ctx: OpContext, input: ProjectInput, origin: ReachOrigin): Promise<PreparedOp> {
  const p = await load(ctx.db as OpDb, input.project_id);
  if (p.status === input.status) throw new ApiError('It is already that way.', 409, 'no_change');
  return {
    reach: checkOp({ op: { op: 'project_status', project_id: p.id, status_before: p.status, status_after: input.status }, now: ctx.now, origin }),
    expect: { status: p.status },
    copy: { clause: `move the "${shortTitle(p.name)}" project to ${input.status.replace('_', ' ')}`, client_lines: [`The "${shortTitle(p.name)}" project will show in the client's portal.`] },
  };
}

function completedFor(from: Row, to: string, now: Date): Date | null {
  if (to === 'done') return now;
  if (from.status === 'done') return null;
  return from.completed_date;
}

async function run(ctx: OpContext, input: ProjectInput, expect: unknown): Promise<OpRun> {
  const e = expectSchema.safeParse(expect);
  if (!e.success) throw new ApiError('Changed since. Open the project.', 409, 'changed_since');
  const db = ctx.db as OpDb;
  // The chat's own write holds the project's lock (a tap reading a task of this project holds it from its re-check to
  // its write). The tap applying this op already holds it (`ctx.actor` set).
  if (!ctx.actor) await lockScope(db, { tasks: [], projects: [input.project_id] });
  const p = await load(db, input.project_id);
  const completed = completedFor(p, input.status, ctx.now);
  const r = await db.project.updateMany({
    where: { id: p.id, status: e.data.status as never, is_deleted: false },
    data: { status: input.status as never, ...(input.status === 'done' || p.status === 'done' ? { completed_date: completed } : {}) },
  });
  if (r.count !== 1) throw new ApiError('Changed since. Open the project.', 409, 'changed_since');
  return {
    target_id: p.id,
    before: { project_id: p.id, status: p.status, completed_date: p.completed_date?.toISOString() ?? null },
    after: { project_id: p.id, status: input.status, completed_date: completed?.toISOString() ?? null },
    summary: opSummary({ op: 'project_status', name: p.name, status: input.status }, ctx.now),
    result: { project_id: p.id, status: input.status },
    undoable: true,
  };
}

export const projectOp: OpDef<ProjectInput> = {
  name: 'project',
  target_type: 'project',
  tool: 'change_project',
  validate: (raw) => inputSchema.parse(raw),
  targetId: (input) => input.project_id,
  prepare,
  run,
  async prepareUndo(ctx, record) {
    const before = snapSchema.safeParse(record.before);
    const after = snapSchema.safeParse(record.after);
    if (!before.success || !after.success) throw new ApiError("That can't be undone from here. Open it in Citadel.", 409, 'not_undoable');
    const p = await load(ctx.db as OpDb, after.data.project_id);
    if (p.status !== after.data.status) throw new ApiError('Changed since. Open the project.', 409, 'changed_since');
    return {
      reach: checkOp({ op: { op: 'project_status', project_id: p.id, status_before: p.status, status_after: before.data.status }, now: ctx.now, origin: 'undo' }),
      expect: { status: p.status },
      copy: { clause: `put the "${shortTitle(p.name)}" project back to ${before.data.status.replace('_', ' ')}`, client_lines: [`The "${shortTitle(p.name)}" project will show in the client's portal.`] },
    };
  },
  async undo(ctx, record, expect) {
    const before = snapSchema.safeParse(record.before);
    const e = expectSchema.safeParse(expect);
    if (!before.success || !e.success) return { ok: false, reason: 'invalid' };
    const b = before.data;
    const r = await (ctx.db as OpDb).project.updateMany({
      where: { id: b.project_id, status: e.data.status as never, is_deleted: false },
      data: { status: b.status as never, completed_date: b.completed_date ? new Date(b.completed_date) : null },
    });
    return r.count === 1 ? { ok: true } : { ok: false, reason: 'changed_since' };
  },
};
