/**
 * Item-level sitemap edits on a project in any status but done or cancelled (the chat lane, Dox inside his binding, the owner's session).
 * A sitemap is the project's ProjectPage rows. Nothing points at a page row (no task, design session or site page holds its id; the setup
 * wizard only copies the page name into the titles of the tasks it makes), so dropping a page deletes only that row and never a task. A drop
 * says how many open tasks still name the page in their title, so the line and the reply can tell the owner those tasks stay.
 * Every page added, changed or dropped is one change line (area plan:sitemap) on each project-setup card of the project, with the optional source
 * kept in `detail` in the same shape the date lines use.
 */
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { dateSourceSchema, type DateSource } from '@/lib/tasks/plan-schema';
import { recordTriageChange, type Actor } from '@/lib/tasks/triage-rev';

type Db = PrismaClient | Prisma.TransactionClient;

export const SITEMAP_AREA = 'plan:sitemap';
export const SITEMAP_CLOSED_STATUSES = ['done', 'cancelled'] as const;

const pageFields = {
  page_type: z.string().trim().max(50).nullable().optional(),
  needs_design: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
};
const pageName = z.string().trim().min(1).max(255);

export const sitemapPatchSchema = z
  .object({
    add: z.array(z.object({ name: pageName, ...pageFields }).strict()).max(40).optional(),
    change: z
      .array(
        z
          .object({ id: z.string().uuid(), name: pageName.optional(), ...pageFields })
          .strict()
          .refine((v) => v.name !== undefined || v.page_type !== undefined || v.needs_design !== undefined || v.notes !== undefined, { message: 'Say what to change on the page.' }),
      )
      .max(40)
      .optional(),
    drop: z.array(z.string().uuid()).max(40).optional(),
    source: dateSourceSchema.optional(),
  })
  .strict()
  .refine((v) => (v.add?.length ?? 0) + (v.change?.length ?? 0) + (v.drop?.length ?? 0) > 0, { message: 'Send add, change, drop, or a mix.' });
export type SitemapPatch = z.infer<typeof sitemapPatchSchema>;

export interface PageIn {
  name: string;
  page_type?: string | null;
  needs_design?: boolean;
  notes?: string | null;
}
export interface SitemapLine {
  op: 'add' | 'change' | 'drop';
  page: string;
  line: string;
}
export interface SitemapResult {
  lines: SitemapLine[];
  /** Pages that were dropped while open tasks still name them in their title: those tasks are untouched. */
  dropped_with_tasks: { page: string; open_tasks: number }[];
  sitemap: { id: string; name: string; page_type: string | null; needs_design: boolean; notes: string | null }[];
}

const key = (s: string) => s.trim().toLowerCase();
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tail = (source?: DateSource) => (source ? `, from ${source.label}` : '');

/** Refuses a project that is done or cancelled; returns nothing otherwise. */
export function assertSitemapOpen(status: string): void {
  if ((SITEMAP_CLOSED_STATUSES as readonly string[]).includes(status)) {
    throw new ApiError(`The sitemap of a ${status === 'done' ? 'finished' : 'cancelled'} project is not changed.`, 409, 'project_closed');
  }
}

type PageRow = { id: string; name: string; page_type: string | null; needs_design: boolean; notes: string | null; sort_order: number };

async function openTasksNaming(db: Db, projectId: string, name: string): Promise<number> {
  return db.task.count({
    where: { project_id: projectId, is_deleted: false, status: { notIn: ['done', 'abandoned'] }, title: { contains: name, mode: 'insensitive' } },
  });
}

/** Apply one add/change/drop request inside the caller's transaction. Refuses the whole request on the first problem (nothing half applied). */
export async function applySitemapPatch(tx: Db, projectId: string, patch: Pick<SitemapPatch, 'add' | 'change' | 'drop'>): Promise<SitemapResult> {
  const rows: PageRow[] = await tx.projectPage.findMany({ where: { project_id: projectId }, orderBy: [{ sort_order: 'asc' }, { name: 'asc' }] });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const names = new Map(rows.map((r) => [key(r.name), r.id]));
  const lines: SitemapLine[] = [];
  const droppedWithTasks: { page: string; open_tasks: number }[] = [];

  const dropIds = new Set(patch.drop ?? []);
  for (const id of dropIds) if (!byId.has(id)) throw new ApiError('A page to drop is not in this project\'s sitemap.', 404, 'page_not_found');
  const changeIds = new Set<string>();
  for (const c of patch.change ?? []) {
    if (!byId.has(c.id)) throw new ApiError('A page to change is not in this project\'s sitemap.', 404, 'page_not_found');
    if (dropIds.has(c.id)) throw new ApiError('A page cannot be changed and dropped in one request.', 409, 'page_conflict');
    if (changeIds.has(c.id)) throw new ApiError('A page is changed twice in one request.', 409, 'page_conflict');
    changeIds.add(c.id);
  }

  // Drops first, so a page can be dropped and its name reused in the same request.
  for (const id of dropIds) {
    const row = byId.get(id)!;
    const open = await openTasksNaming(tx, projectId, row.name);
    await tx.projectPage.delete({ where: { id } });
    names.delete(key(row.name));
    if (open > 0) droppedWithTasks.push({ page: row.name, open_tasks: open });
    lines.push({ op: 'drop', page: row.name, line: `Page dropped: ${clip(row.name)}${open > 0 ? ` (${open} open task${open === 1 ? '' : 's'} still name it and stay)` : ''}` });
  }

  for (const c of patch.change ?? []) {
    const row = byId.get(c.id)!;
    const data: Prisma.ProjectPageUpdateInput = {};
    const bits: string[] = [];
    if (c.name !== undefined && c.name !== row.name) {
      const other = names.get(key(c.name));
      if (other && other !== row.id) throw new ApiError(`There is already a page named "${c.name}".`, 409, 'page_exists');
      names.delete(key(row.name));
      names.set(key(c.name), row.id);
      data.name = c.name;
      bits.push(`name from ${clip(row.name)} to ${clip(c.name)}`);
    }
    if (c.page_type !== undefined && (c.page_type || null) !== row.page_type) {
      data.page_type = c.page_type || null;
      bits.push(`type from ${row.page_type ?? 'none'} to ${c.page_type || 'none'}`);
    }
    if (c.needs_design !== undefined && c.needs_design !== row.needs_design) {
      data.needs_design = c.needs_design;
      bits.push(c.needs_design ? 'now needs design' : 'no longer needs design');
    }
    if (c.notes !== undefined && (c.notes || null) !== row.notes) {
      data.notes = c.notes || null;
      bits.push('notes updated');
    }
    if (bits.length === 0) continue; // nothing really changed
    await tx.projectPage.update({ where: { id: row.id }, data });
    lines.push({ op: 'change', page: c.name ?? row.name, line: `Page changed: ${clip(row.name)}, ${bits.join(', ')}` });
  }

  let next = rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
  for (const a of patch.add ?? []) {
    if (names.has(key(a.name))) throw new ApiError(`There is already a page named "${a.name}".`, 409, 'page_exists');
    await tx.projectPage.create({ data: { project_id: projectId, name: a.name, page_type: a.page_type || null, needs_design: a.needs_design ?? false, notes: a.notes || null, sort_order: next++ } });
    names.set(key(a.name), 'new');
    lines.push({ op: 'add', page: a.name, line: `Page added: ${clip(a.name)}${a.page_type ? ` (${a.page_type})` : ''}` });
  }

  const sitemap = await tx.projectPage.findMany({ where: { project_id: projectId }, orderBy: [{ sort_order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, page_type: true, needs_design: true, notes: true } });
  return { lines, dropped_with_tasks: droppedWithTasks, sitemap };
}

/**
 * The shape route's refusal on a project that is not in the queue becomes this: the sent page list is merged by name. New names are added,
 * same names are updated, names that are missing are dropped under the rule above.
 */
export async function mergePagesByName(tx: Db, projectId: string, pages: PageIn[]): Promise<SitemapResult> {
  const rows = await tx.projectPage.findMany({ where: { project_id: projectId }, select: { id: true, name: true, page_type: true, needs_design: true, notes: true } });
  const byName = new Map(rows.map((r) => [key(r.name), r]));
  const sent = new Set<string>();
  const patch: Required<Pick<SitemapPatch, 'add' | 'change' | 'drop'>> = { add: [], change: [], drop: [] };
  for (const p of pages) {
    const k = key(p.name);
    if (sent.has(k)) throw new ApiError(`The page "${p.name}" is listed twice.`, 400, 'page_listed_twice');
    sent.add(k);
    const have = byName.get(k);
    if (!have) patch.add.push(p);
    else patch.change.push({ id: have.id, page_type: p.page_type ?? null, needs_design: p.needs_design ?? false, notes: p.notes ?? null });
  }
  for (const r of rows) if (!sent.has(key(r.name))) patch.drop.push(r.id);
  // A same-name update that changes nothing has nothing to say; the schema insists on a field, which the lines above always carry.
  return applySitemapPatch(tx, projectId, patch);
}

/** One change line per page change on every project-setup card of the project, with the optional source kept in `detail`. */
export async function recordSitemapChanges(db: Db, projectId: string, lines: SitemapLine[], actor: Actor, source?: DateSource): Promise<number> {
  if (lines.length === 0) return 0;
  const cards = await db.task.findMany({ where: { project_id: projectId, triage_kind: 'project_setup', is_deleted: false }, select: { id: true } });
  let n = 0;
  for (const card of cards) {
    for (const l of lines) {
      const detail = { op: l.op, page: l.page, ...(source ? { source } : {}) } as unknown as Prisma.InputJsonValue;
      await recordTriageChange(db, card.id, SITEMAP_AREA, `${l.line}${tail(source)}`.slice(0, 240), actor, null, detail);
      n += 1;
    }
  }
  return n;
}
