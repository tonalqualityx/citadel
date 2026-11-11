/**
 * Bast chat, op `start_project`: a new project for a client, hidden until it goes live, with a kickoff task for the
 * owner (plan bast-chat-start, slice 2).
 *
 * One transaction, applied at once: the client (only when `new_client` is sent), the project (status `queue`, type
 * `project`, created by the Bast user, no billing, budget, rate or plan folder fields), and the kickoff task
 * (assigned to the owner, tags `from-chat` and `kickoff`, client and site set, NO project because the home screen hides
 * tasks of hidden projects, no due date). The kickoff task holds the owner's message word for word (`message`, passed
 * by the daemon from the turn). The reach check runs on that planned task; it is the owner's own, so it reaches nothing.
 *
 * Record: target_type `project_start`, target_id the project; `before` is `{}`; `after` is
 * `{project_id, task_id, client_id, client_created, site_id}`.
 * Undo: refused ("Changed since. Open the project.") unless the project is still `queue`, the kickoff task is still the
 * owner's and `not_started`, and nothing waits on it. Then, in one transaction with compare-and-set, the project goes
 * to `cancelled` and the task to `abandoned`. A client the op created stays: nothing is deleted.
 */
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { opSummary, type OpContext, type PreparedOp } from '../actions';
import { cleanLine, quoted } from '../card-context';
import type { ReachOrigin } from '../worker-reach';
import { abandonStartTask, checkStartTaskUndo, checklistOf, createStartTask, dateWords, freeText, inOneTransaction, paragraphsOf, pickSite, projectLink, reachOfNewTask, START_CREATED_BY, CHAT_TAG } from './start-common';
import type { OpDef, OpDb, OpRun } from './index';

const inputSchema = z
  .object({
    client_id: z.string().uuid().optional(),
    new_client: freeText(255).optional(),
    what: freeText(2000),
    name: freeText(255).optional(),
    site: freeText(255).optional(),
    message: freeText(4000),
  })
  .strict()
  .refine((v) => (v.client_id === undefined) !== (v.new_client === undefined), { message: 'Send either client_id or new_client, not both and not neither.' });
export type StartProjectInput = z.infer<typeof inputSchema>;

const expectSchema = z.object({ client_id: z.string().uuid().nullable(), site_id: z.string().uuid().nullable() }).strict();
const afterSchema = z
  .object({ project_id: z.string().uuid(), task_id: z.string().uuid(), client_id: z.string().uuid().nullable(), client_created: z.boolean(), site_id: z.string().uuid().nullable() })
  .strict();

const CHANGED = 'Changed since. Open the project.';
const KICKOFF_CHECKLIST = ['Set up the plan folder for the project', 'Write the goal and the first tasks into the plan, each filed to Mike', 'Tell Mike the plan is ready to make live'];

interface Resolved {
  client_id: string | null;
  client_name: string;
  site_id: string | null;
}

async function resolve(db: OpDb, input: StartProjectInput): Promise<Resolved> {
  if (input.client_id) {
    const c = await db.client.findFirst({
      where: { id: input.client_id, is_deleted: false },
      select: { id: true, name: true, sites: { where: { is_deleted: false }, select: { id: true, name: true } } },
    });
    if (!c) throw new ApiError('That client does not exist.', 404, 'client_missing');
    return { client_id: c.id, client_name: c.name, site_id: pickSite(c.sites, c.name, input.site) };
  }
  const name = input.new_client as string;
  const same = await db.client.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, status: 'active', is_deleted: false }, select: { id: true } });
  if (same) throw new ApiError(`There is already an active client called ${quoted(name)}. Use that one.`, 409, 'client_exists');
  if (input.site) throw new ApiError('A new client has no sites yet.', 400, 'site_missing');
  return { client_id: null, client_name: name, site_id: null };
}

const projectName = (input: StartProjectInput) => cleanLine(input.name ?? input.what, input.name ? 255 : 80) || 'New project';

function kickoffText(input: StartProjectInput, name: string, project: { id: string; link: string } | null): string | null {
  return paragraphsOf([
    input.what,
    `Project: ${name}`,
    ...(project ? [`Project id: ${project.id}`, `Project link: ${project.link}`] : []),
    'What Mike wrote in the chat, word for word:',
    input.message,
  ]);
}

async function prepare(ctx: OpContext, input: StartProjectInput, origin: ReachOrigin): Promise<PreparedOp> {
  const r = await resolve(ctx.db as OpDb, input);
  const name = projectName(input);
  const reach = reachOfNewTask(
    ctx,
    { title: `Kick off ${name}`, description: kickoffText(input, name, null), requirements: null, client_id: r.client_id, site_id: r.site_id, tags: [CHAT_TAG, 'kickoff'] },
    origin,
  );
  return {
    reach,
    expect: { client_id: r.client_id, site_id: r.site_id },
    copy: { clause: `start the ${quoted(name, 80)} project for ${cleanLine(r.client_name, 60)}` },
  };
}

async function run(ctx: OpContext, input: StartProjectInput, expect: unknown): Promise<OpRun> {
  const e = expectSchema.safeParse(expect);
  if (!e.success) throw new ApiError(CHANGED, 409, 'changed_since');
  const db = ctx.db as OpDb;
  const r = await resolve(db, input);
  if (r.client_id !== e.data.client_id || r.site_id !== e.data.site_id) throw new ApiError(CHANGED, 409, 'changed_since');

  let clientId = r.client_id;
  const clientCreated = clientId === null;
  if (clientId === null) {
    const c = await db.client.create({ data: { name: r.client_name }, select: { id: true } });
    clientId = c.id;
  }
  const name = projectName(input);
  const project = await db.project.create({
    data: {
      name,
      description: paragraphsOf([input.what, `Started from Mike's chat on ${dateWords(ctx.now)}.`]),
      status: 'queue',
      type: 'project',
      client_id: clientId,
      site_id: r.site_id,
      created_by_id: START_CREATED_BY,
    },
    select: { id: true },
  });
  const taskId = randomUUID();
  await createStartTask(db, {
    id: taskId,
    title: `Kick off ${name}`,
    description: kickoffText(input, name, { id: project.id, link: projectLink(project.id) }),
    requirements: checklistOf(KICKOFF_CHECKLIST, taskId),
    client_id: clientId,
    site_id: r.site_id,
    accord_id: null,
    tags: [CHAT_TAG, 'kickoff'],
    ownerId: ctx.ownerId,
  });
  return {
    target_id: project.id,
    before: {},
    after: { project_id: project.id, task_id: taskId, client_id: clientId, client_created: clientCreated, site_id: r.site_id },
    summary: opSummary({ op: 'start_project', name, client_name: r.client_name, client_created: clientCreated }, ctx.now),
    result: { project_id: project.id, task_id: taskId, client_id: clientId, client_created: clientCreated, site_id: r.site_id },
    undoable: true,
  };
}

export const startProjectOp: OpDef<StartProjectInput> = {
  name: 'start_project',
  target_type: 'project_start',
  tool: 'start_project',
  validate: (raw) => inputSchema.parse(raw),
  // The project does not exist yet; the proposal (when the reach check ever asks for one) points at the client or the owner.
  targetId: (input) => input.client_id ?? '00000000-0000-4000-8000-000000000000',
  prepare,
  run,
  async prepareUndo(ctx, record) {
    const after = afterSchema.safeParse(record.after);
    if (!after.success) throw new ApiError("That can't be undone from here. Open it in Citadel.", 409, 'not_undoable');
    const p = await (ctx.db as OpDb).project.findFirst({ where: { id: after.data.project_id, is_deleted: false }, select: { id: true, name: true, status: true } });
    if (!p || p.status !== 'queue') throw new ApiError(CHANGED, 409, 'changed_since');
    const reach = await checkStartTaskUndo(ctx, after.data.task_id, CHANGED);
    return { reach, expect: { project_id: p.id, task_id: after.data.task_id }, copy: { clause: `cancel the ${quoted(p.name, 80)} project and drop its kickoff task` } };
  },
  async undo(ctx, record) {
    const after = afterSchema.safeParse(record.after);
    if (!after.success) return { ok: false, reason: 'invalid' };
    const a = after.data;
    try {
      await inOneTransaction(ctx.db as OpDb, async (tx) => {
        const p = await tx.project.updateMany({ where: { id: a.project_id, status: 'queue', is_deleted: false }, data: { status: 'cancelled' } });
        if (p.count !== 1 || !(await abandonStartTask(tx, a.task_id, ctx.ownerId))) throw new ApiError(CHANGED, 409, 'changed_since');
      });
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 409) return { ok: false, reason: 'changed_since' };
      throw e;
    }
    return { ok: true };
  },
};
