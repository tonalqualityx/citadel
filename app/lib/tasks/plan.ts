/**
 * The plan of a Triage card, server side: who may read and write it, loading it whole, replacing one section, and changing one item.
 * Shapes and validation live in plan-schema.ts. Every write is one transaction under the task row lock and leaves a change line
 * (recordTriageChange), which is what moves triage_rev while the card is in Triage and what the plan header reads "last changed by".
 *
 * READ: while the card is in Triage only Mike (session or key), the chat lane and the Dox lane; after release anyone who can see the task
 * except a designer, and a contractor (tech) sees the plan without its billing section. Never the client portal (it has no staff session).
 * Everyone who may not read gets the same 404 as a card that does not exist.
 * WRITE: Mike's own session and the enforced chat lane (the same check as leaving Triage), and the Dox lane under its project binding
 * (lib/dox/guard.ts guardDoxTaskWrite: a Triage card or a card with no project is open; a released project card needs the x-dox-project header and an open pass).
 * "Mark wrong" is Mike's (session or chat relaying his words).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { guardDoxTaskWrite, isDoxLane } from '@/lib/dox/guard';
import { mayLeaveTriage } from '@/lib/services/task-patch';
import { isChatLane } from './questions';
import { actorOf, recordTriageChange, type Actor } from './triage-rev';
import { projectBlocks } from './triage-card';
import {
  ITEM_SCHEMAS,
  PLAN_LIMITS,
  PLAN_SECTIONS,
  PLAN_SECTION_TITLES,
  PROJECT_DATE_MESSAGE,
  isProjectDateLabel,
  planChangeLine,
  type PlanItemOut,
  type PlanOut,
  type PlanSectionName,
  type PlanSectionOut,
} from './plan-schema';

type Auth = Pick<AuthPayload, 'userId' | 'role' | 'via' | 'lane' | 'laneEnforced'>;
type Hdrs = Pick<Headers, 'get'>;
export interface PlanTaskHead {
  id: string;
  status: string;
  project_id: string | null;
  triage_kind: string | null;
  triage_rev: number;
}

const notFound = () => new ApiError('Task not found', 404);

/** Throws a 404 unless this caller may read the plan. Returns whether the billing section is withheld from them. */
export function assertCanReadPlan(task: Pick<PlanTaskHead, 'status'>, auth: Auth): { withholdBilling: boolean } {
  if (auth.role === 'designer') throw notFound();
  if (task.status === 'triage') {
    if (auth.role === 'tech') throw notFound();
    if (auth.userId === MIKE_USER_ID || isChatLane(auth) || isDoxLane(auth)) return { withholdBilling: false };
    throw notFound();
  }
  return { withholdBilling: auth.role === 'tech' };
}

export const PLAN_FORBIDDEN = 'Only Mike, the chat and Dox write the plan.';
export const MARK_WRONG_FORBIDDEN = 'Only Mike can mark a plan line wrong.';

/** Throws a 403 unless this caller may write the plan (the read check has already run). */
export async function assertCanWritePlan(task: PlanTaskHead, auth: Auth, headers: Hdrs): Promise<void> {
  if (mayLeaveTriage(auth)) return;
  if (isDoxLane(auth)) {
    await guardDoxTaskWrite(auth, headers, { status: task.status, project_id: task.project_id });
    return;
  }
  throw new ApiError(PLAN_FORBIDDEN, 403, 'plan_forbidden');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(message: string, code = 'plan_invalid'): never {
  throw new ApiError(message, 400, code);
}

/** Validate one raw item for a section with its own zod schema; the first problem comes back in plain words. */
export function parseItem(section: PlanSectionName, raw: unknown): Record<string, unknown> {
  const r = ITEM_SCHEMAS[section].safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    const where = i.path.length ? `${i.path.join('.')}: ` : '';
    bad(`${PLAN_SECTION_TITLES[section]}: ${where}${i.message}`);
  }
  return (r as { data: Record<string, unknown> }).data;
}

/** Checks that need the card or the database: project dates, team members, the billing shape. Throws a 400. */
async function sectionChecks(db: Pick<PrismaClient, 'user'>, task: PlanTaskHead, section: PlanSectionName, items: Record<string, unknown>[]): Promise<void> {
  if (items.length > PLAN_LIMITS[section]) bad(`${PLAN_SECTION_TITLES[section]} holds at most ${PLAN_LIMITS[section]} lines.`, 'plan_too_many');
  if (section === 'dates' && task.triage_kind === 'project_setup' && task.project_id) {
    if (items.some((i) => isProjectDateLabel(String(i.label)))) bad(PROJECT_DATE_MESSAGE, 'plan_project_date');
  }
  if (section === 'team') {
    const ids = items.map((i) => (i.person as { user_id?: string }).user_id).filter((x): x is string => !!x);
    if (ids.length) {
      const found = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
      const have = new Set(found.map((u) => u.id));
      const missing = ids.find((x) => !have.has(x));
      if (missing) bad('Team: that user does not exist.', 'plan_unknown_user');
    }
  }
  if (section === 'billing') {
    const basis = items.filter((i) => i.type === 'basis');
    const miles = items.filter((i) => i.type === 'milestone');
    if (basis.length > 1) bad('Billing model has one basis line (kind, what it refers to, source).', 'plan_billing_shape');
    if (miles.length > 0 && (basis.length === 0 || basis[0].kind !== 'milestones')) bad('Milestones belong to a billing model of kind milestones. Set the basis line first.', 'plan_billing_shape');
  }
}

/** Billing keeps its basis line first, whatever order it was sent in. */
function orderItems(section: PlanSectionName, items: Record<string, unknown>[]): Record<string, unknown>[] {
  if (section !== 'billing') return items;
  return [...items.filter((i) => i.type === 'basis'), ...items.filter((i) => i.type !== 'basis')];
}

type ItemRow = Prisma.TaskPlanItemGetPayload<object>;

export function formatItem(r: ItemRow): PlanItemOut {
  const data = (r.data ?? {}) as Record<string, unknown>;
  return {
    ...data,
    id: r.id,
    position: r.position,
    marked_wrong: r.wrong_at !== null,
    marked_wrong_at: r.wrong_at ? r.wrong_at.toISOString() : null,
    marked_wrong_by: r.wrong_by,
    updated_at: r.updated_at.toISOString(),
    updated_by: r.updated_by,
  };
}

/** Key order is not meaning (jsonb reorders keys), so lines are compared with sorted keys. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/** Replace one section's items. Lines with an id keep their row; a line whose words changed loses its Mark wrong flag. */
export async function putSection(task: PlanTaskHead, auth: Auth, section: PlanSectionName, rawItems: Record<string, unknown>[], description?: string): Promise<PlanItemOut[]> {
  const actor = await actorOf(auth);
  const wanted = rawItems.map((raw) => {
    const { id, ...rest } = raw as Record<string, unknown> & { id?: unknown };
    if (id !== undefined && (typeof id !== 'string' || !UUID_RE.test(id))) bad(`${PLAN_SECTION_TITLES[section]}: id must be the id of an existing line.`, 'plan_bad_id');
    return { id: id as string | undefined, data: parseItem(section, rest) };
  });
  const ordered = orderItems(section, wanted.map((w) => w.data));
  // keep each id with its data after ordering
  const withIds = orderItems(section, wanted.map((w) => ({ ...w.data, __id: w.id }))) as (Record<string, unknown> & { __id?: string })[];
  await sectionChecks(prisma, task, section, ordered);
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const existing = await tx.taskPlanItem.findMany({ where: { task_id: task.id, section } });
    const byId = new Map(existing.map((e) => [e.id, e]));
    const keep = new Set<string>();
    for (const w of withIds) if (w.__id) {
      if (!byId.has(w.__id)) bad(`${PLAN_SECTION_TITLES[section]}: id ${w.__id} is not a line of this section.`, 'plan_bad_id');
      keep.add(w.__id);
    }
    await tx.taskPlanItem.deleteMany({ where: { task_id: task.id, section, id: { notIn: Array.from(keep) } } });
    const out: ItemRow[] = [];
    for (let i = 0; i < withIds.length; i++) {
      const { __id, ...data } = withIds[i];
      const json = data as unknown as Prisma.InputJsonValue;
      if (__id) {
        const prev = byId.get(__id)!;
        const unchanged = same(prev.data, JSON.parse(JSON.stringify(data)));
        out.push(
          await tx.taskPlanItem.update({
            where: { id: __id },
            data: { position: i, data: json, updated_by: actor.by, updated_by_user_id: actor.userId, ...(unchanged ? {} : { wrong_at: null, wrong_by: null }) },
          }),
        );
      } else {
        out.push(await tx.taskPlanItem.create({ data: { task_id: task.id, section, position: i, data: json, updated_by: actor.by, updated_by_user_id: actor.userId } }));
      }
    }
    await recordTriageChange(tx, task.id, `plan:${section}`, planChangeLine(section, actor.by), actor, description);
    return out;
  });
  return rows.map(formatItem);
}

export type PatchOp =
  | { op: 'add'; item: Record<string, unknown>; description?: string }
  | { op: 'change'; id: string; item: Record<string, unknown>; description?: string }
  | { op: 'remove'; id: string; description?: string }
  | { op: 'mark_wrong'; id: string; wrong: boolean; description?: string };

/** Add, change, remove or mark wrong one item. Returns the section's items after the change. */
export async function patchSection(task: PlanTaskHead, auth: Auth, section: PlanSectionName, body: PatchOp): Promise<PlanItemOut[]> {
  if (body.op === 'mark_wrong' && !mayLeaveTriage(auth)) throw new ApiError(MARK_WRONG_FORBIDDEN, 403, 'plan_forbidden');
  const actor: Actor = await actorOf(auth);
  const data = body.op === 'add' || body.op === 'change' ? parseItem(section, body.item) : null;
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${task.id}::uuid FOR UPDATE`;
    const existing = await tx.taskPlanItem.findMany({ where: { task_id: task.id, section }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] });
    const target = body.op === 'add' ? null : existing.find((e) => e.id === body.id);
    if (body.op !== 'add' && !target) throw new ApiError('That line is not in this section.', 404, 'plan_item_missing');
    let verb = 'updated';
    if (body.op === 'add') {
      const merged = [...existing.map((e) => e.data as Record<string, unknown>), data!];
      await sectionChecks(tx as never, task, section, merged);
      if (section === 'billing' && data!.type === 'basis') {
        // the basis line goes first
        await tx.taskPlanItem.updateMany({ where: { task_id: task.id, section }, data: { position: { increment: 1 } } });
        await tx.taskPlanItem.create({ data: { task_id: task.id, section, position: 0, data: data as Prisma.InputJsonValue, updated_by: actor.by, updated_by_user_id: actor.userId } });
      } else {
        await tx.taskPlanItem.create({ data: { task_id: task.id, section, position: existing.length, data: data as Prisma.InputJsonValue, updated_by: actor.by, updated_by_user_id: actor.userId } });
      }
    } else if (body.op === 'change') {
      const merged = existing.map((e) => (e.id === body.id ? data! : (e.data as Record<string, unknown>)));
      await sectionChecks(tx as never, task, section, merged);
      const unchanged = same(target!.data, JSON.parse(JSON.stringify(data)));
      await tx.taskPlanItem.update({
        where: { id: body.id },
        data: { data: data as Prisma.InputJsonValue, updated_by: actor.by, updated_by_user_id: actor.userId, ...(unchanged ? {} : { wrong_at: null, wrong_by: null }) },
      });
    } else if (body.op === 'remove') {
      await tx.taskPlanItem.delete({ where: { id: body.id } });
      const left = existing.filter((e) => e.id !== body.id);
      for (let i = 0; i < left.length; i++) if (left[i].position !== i) await tx.taskPlanItem.update({ where: { id: left[i].id }, data: { position: i } });
      verb = 'line removed';
    } else {
      await tx.taskPlanItem.update({
        where: { id: body.id },
        data: body.wrong ? { wrong_at: new Date(), wrong_by: actor.by } : { wrong_at: null, wrong_by: null },
      });
      verb = body.wrong ? 'line marked wrong' : 'mark wrong cleared';
    }
    const line = verb === 'updated' ? planChangeLine(section, actor.by) : `Plan: ${PLAN_SECTION_TITLES[section]} ${verb} by ${actor.by}`;
    await recordTriageChange(tx, task.id, `plan:${section}`, line, actor, body.description);
    return tx.taskPlanItem.findMany({ where: { task_id: task.id, section }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] });
  });
  return rows.map(formatItem);
}

/** Whether this caller could write right now (drives the screen's controls; the write routes check again). */
async function canWriteNow(task: PlanTaskHead, auth: Auth, headers: Hdrs): Promise<boolean> {
  try {
    await assertCanWritePlan(task, auth, headers);
    return true;
  } catch {
    return false;
  }
}

/** The whole plan: sections in fixed order, each with its items and its last-change line; the answered questions and the project block read through. */
export async function loadPlan(task: PlanTaskHead, auth: Auth, headers: Hdrs): Promise<PlanOut> {
  const { withholdBilling } = assertCanReadPlan(task, auth);
  const [items, changes, answered, canWrite] = await Promise.all([
    prisma.taskPlanItem.findMany({ where: { task_id: task.id }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] }),
    prisma.triageChange.findMany({ where: { task_id: task.id, area: { startsWith: 'plan:' } }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: 200 }),
    prisma.taskQuestion.findMany({ where: { task_id: task.id, state: 'answered' }, orderBy: [{ answered_at: 'desc' }, { position: 'asc' }] }),
    canWriteNow(task, auth, headers),
  ]);
  // Team lines name a Citadel user by id: the screen needs the name (and whether it is Mike) without a second call.
  const teamIds = items.filter((i) => i.section === 'team').map((i) => ((i.data as { person?: { user_id?: string } }).person?.user_id)).filter((x): x is string => !!x);
  const people = teamIds.length ? await prisma.user.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(people.map((u) => [u.id, u.name]));
  const sections: PlanSectionOut[] = PLAN_SECTIONS.map((section) => {
    const last = changes.find((c) => c.area === `plan:${section}`);
    const withheld = section === 'billing' && withholdBilling;
    return {
      section,
      title: PLAN_SECTION_TITLES[section],
      items: withheld
        ? []
        : items
            .filter((i) => i.section === section)
            .map((i) => {
              const out = formatItem(i);
              const uid = section === 'team' ? (out.person as { user_id?: string } | undefined)?.user_id : undefined;
              return uid ? { ...out, person_name: nameOf.get(uid) ?? 'Unknown user', is_mike: uid === MIKE_USER_ID } : out;
            }),
      ...(withheld ? { withheld: true } : {}),
      updated_at: last ? last.created_at.toISOString() : null,
      updated_by: last ? last.by : null,
      note: last?.note ?? null,
    };
  });
  let project: PlanOut['project'] = null;
  if (task.triage_kind === 'project_setup' && task.project_id) {
    const blk = (await projectBlocks(prisma as never, [task.project_id])).get(task.project_id);
    if (blk) {
      project = {
        project_id: blk.project_id,
        name: blk.name,
        status: blk.status,
        start_date: blk.start_date,
        target_date: blk.target_date,
        mike_parts: blk.mike_parts,
        phases: blk.phases,
        sitemap: blk.sitemap,
        deal: blk.deal,
      };
    }
  }
  const latest = changes[0];
  return {
    task_id: task.id,
    status: task.status,
    triage_rev: task.triage_rev,
    viewer: { can_write: canWrite, is_owner: mayLeaveTriage(auth) },
    sections,
    updated_at: latest ? latest.created_at.toISOString() : null,
    updated_by: latest ? latest.by : null,
    answered_questions: answered
      .filter((q) => q.answer_text)
      .map((q) => ({ id: q.id, question: q.question, answer: q.answer_text as string, answered_at: q.answered_at ? q.answered_at.toISOString() : null, by_mike: true as const })),
    project,
  };
}
