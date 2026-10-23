import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import type { TokenPayload } from '@/lib/auth/jwt';

// Fleet item 2: the decision record. Shared pieces for the /api/decisions routes.
// Scope ids are plain uuids (no relations), so nothing here can block a delete elsewhere.

export const DECISION_KINDS = ['ruling', 'client_decision', 'policy'] as const;
export const DECISION_STATUSES = [
  'proposed',
  'recorded_from_source',
  'confirmed',
  'superseded',
  'retracted',
  'rejected',
] as const;
export const DECISION_SCOPES = ['fleet', 'lane', 'client', 'project', 'charter', 'site', 'accord'] as const;
export const DECISION_SOURCE_KINDS = ['session', 'transcript', 'email', 'doc', 'memory', 'portal'] as const;

/** Statuses that count as "in force". */
export const ACTIVE_STATUSES = ['recorded_from_source', 'confirmed'] as const;
/** The only statuses an ordinary POST may write. */
export const POSTABLE_STATUSES = ['proposed', 'recorded_from_source'] as const;
/** In-scope reads are capped here. */
export const IN_SCOPE_CAP = 60;

export function requireAdmin(user: TokenPayload): void {
  if (user.role !== 'admin') throw new ApiError('Admin only', 403);
}

const optUuid = z.string().uuid().optional().nullable();

export const sourceSchema = z.object({
  kind: z.enum(DECISION_SOURCE_KINDS),
  ref: z.string().min(1).max(1000),
  thread_ref: z.string().max(1000).optional().nullable(),
  quote: z.string().optional().nullable(),
  author_label: z.string().max(200).optional().nullable(),
  author_user_id: optUuid,
  author_contact_id: optUuid,
  at: z.coerce.date().optional().nullable(),
  extracted_by: z.string().max(100).optional().nullable(),
});

export const linkSchema = z.object({
  entity_kind: z.string().min(1).max(50),
  entity_id: z.string().min(1).max(500),
  relation: z.string().min(1).max(50).default('governs'),
});

const decisionFields = {
  key: z.string().min(1).max(200).optional().nullable(),
  title: z.string().min(1).max(300),
  text: z.string().min(1),
  kind: z.enum(DECISION_KINDS).default('ruling'),
  scope: z.enum(DECISION_SCOPES).default('fleet'),
  lane: z.string().max(100).optional().nullable(),
  client_id: optUuid,
  project_id: optUuid,
  charter_id: optUuid,
  site_id: optUuid,
  accord_id: optUuid,
  author_user_id: optUuid,
  author_contact_id: optUuid,
  ruled_at: z.coerce.date().optional().nullable(),
  conflict_note: z.string().optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
  tags: z.array(z.string().max(100)).default([]),
  sources: z.array(sourceSchema).default([]),
  links: z.array(linkSchema).default([]),
};

export const createDecisionSchema = z.object({
  ...decisionFields,
  status: z.enum(DECISION_STATUSES).default('proposed'),
});

export const importItemSchema = z.object({
  ...decisionFields,
  key: z.string().min(1).max(200),
  status: z.enum(['proposed', 'recorded_from_source', 'confirmed']).default('recorded_from_source'),
  /** Key of the older decision this one supersedes. */
  supersedes_key: z.string().min(1).max(200).optional().nullable(),
});

export const importSchema = z.object({
  decisions: z.array(importItemSchema).min(1).max(500),
});

export const DECISION_INCLUDE = {
  sources: { orderBy: { created_at: 'asc' } },
  links: { orderBy: { created_at: 'asc' } },
} satisfies Prisma.DecisionInclude;

type DecisionWithRels = Prisma.DecisionGetPayload<{ include: typeof DECISION_INCLUDE }>;

export function formatDecision(d: DecisionWithRels) {
  return {
    id: d.id,
    key: d.key,
    title: d.title,
    text: d.text,
    kind: d.kind,
    status: d.status,
    scope: d.scope,
    lane: d.lane,
    client_id: d.client_id,
    project_id: d.project_id,
    charter_id: d.charter_id,
    site_id: d.site_id,
    accord_id: d.accord_id,
    author_user_id: d.author_user_id,
    author_contact_id: d.author_contact_id,
    ruled_at: d.ruled_at,
    revision: d.revision,
    supersedes_id: d.supersedes_id,
    conflict_note: d.conflict_note,
    confidence: d.confidence == null ? null : Number(d.confidence),
    confirmed_by_user_id: d.confirmed_by_user_id,
    confirmed_at: d.confirmed_at,
    created_by_id: d.created_by_id,
    tags: d.tags,
    created_at: d.created_at,
    updated_at: d.updated_at,
    sources: (d.sources ?? []).map((s) => ({
      id: s.id,
      kind: s.kind,
      ref: s.ref,
      thread_ref: s.thread_ref,
      quote: s.quote,
      author_label: s.author_label,
      at: s.at,
      extracted_by: s.extracted_by,
    })),
    links: (d.links ?? []).map((l) => ({
      id: l.id,
      entity_kind: l.entity_kind,
      entity_id: l.entity_id,
      relation: l.relation,
    })),
  };
}

// ---- in-scope ----

export interface InScopeParams {
  task?: string | null;
  project?: string | null;
  charter?: string | null;
  client?: string | null;
  lane?: string | null;
  accord?: string | null;
  site?: string | null;
}

export interface ResolvedScope {
  task: string | null;
  project: string | null;
  charter: string | null;
  client: string | null;
  lane: string | null;
  accord: string | null;
  site: string | null;
}

const SCOPE_RANK: Record<string, number> = {
  task: 0,
  accord: 1,
  charter: 1,
  site: 1,
  project: 2,
  client: 3,
  lane: 4,
  fleet: 5,
};

/** Fills in the ids a task or project implies, so a task call also gets its client's rulings. */
export async function resolveScope(p: InScopeParams): Promise<ResolvedScope> {
  const s: ResolvedScope = {
    task: p.task ?? null,
    project: p.project ?? null,
    charter: p.charter ?? null,
    client: p.client ?? null,
    lane: p.lane ?? null,
    accord: p.accord ?? null,
    site: p.site ?? null,
  };
  if (s.task) {
    const t = await prisma.task.findUnique({
      where: { id: s.task },
      select: { project_id: true, client_id: true, charter_id: true, site_id: true, accord_id: true },
    });
    if (!t) throw new ApiError('Task not found', 404);
    s.project ??= t.project_id;
    s.client ??= t.client_id;
    s.charter ??= t.charter_id;
    s.site ??= t.site_id;
    s.accord ??= t.accord_id;
  }
  if (s.project && !s.client) {
    const pr = await prisma.project.findUnique({ where: { id: s.project }, select: { client_id: true } });
    s.client ??= pr?.client_id ?? null;
  }
  if (s.charter && !s.client) {
    const ch = await prisma.charter.findUnique({ where: { id: s.charter }, select: { client_id: true } });
    s.client ??= ch?.client_id ?? null;
  }
  return s;
}

export function hasAnyScope(p: InScopeParams): boolean {
  return Boolean(p.task || p.project || p.charter || p.client || p.lane || p.accord || p.site);
}

/**
 * Active decisions that govern the given scope: fleet-wide, the lane, the client, the
 * project/charter/site/accord, and anything linked to the task or those entities.
 * Most specific first, newest first, capped at IN_SCOPE_CAP.
 */
export async function findInScope(params: InScopeParams) {
  const s = await resolveScope(params);

  const or: Prisma.DecisionWhereInput[] = [{ scope: 'fleet' }];
  if (s.lane) or.push({ scope: 'lane', lane: s.lane });
  if (s.client) or.push({ scope: 'client', client_id: s.client });
  if (s.project) or.push({ scope: 'project', project_id: s.project });
  if (s.charter) or.push({ scope: 'charter', charter_id: s.charter });
  if (s.site) or.push({ scope: 'site', site_id: s.site });
  if (s.accord) or.push({ scope: 'accord', accord_id: s.accord });

  const linkPairs: Array<{ entity_kind: string; entity_id: string }> = [];
  if (s.task) linkPairs.push({ entity_kind: 'task', entity_id: s.task });
  if (s.project) linkPairs.push({ entity_kind: 'project', entity_id: s.project });
  if (s.charter) linkPairs.push({ entity_kind: 'charter', entity_id: s.charter });
  if (s.client) linkPairs.push({ entity_kind: 'client', entity_id: s.client });
  if (s.site) linkPairs.push({ entity_kind: 'site', entity_id: s.site });
  if (s.accord) linkPairs.push({ entity_kind: 'accord', entity_id: s.accord });
  if (linkPairs.length) or.push({ links: { some: { OR: linkPairs } } });

  const rows = await prisma.decision.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] }, OR: or },
    include: DECISION_INCLUDE,
    orderBy: { created_at: 'desc' },
  });

  const rank = (d: DecisionWithRels) => {
    const linkedToTask = s.task && d.links.some((l) => l.entity_kind === 'task' && l.entity_id === s.task);
    return linkedToTask ? 0 : (SCOPE_RANK[d.scope] ?? 9);
  };
  const time = (d: DecisionWithRels) => (d.ruled_at ?? d.created_at).getTime();
  rows.sort((a, b) => rank(a) - rank(b) || time(b) - time(a));

  const truncated = rows.length > IN_SCOPE_CAP;
  return {
    scope: s,
    decisions: rows.slice(0, IN_SCOPE_CAP).map(formatDecision),
    total_matched: rows.length,
    truncated,
  };
}

// ---- supersession ----

const SUPERSEDABLE: readonly string[] = ['proposed', 'recorded_from_source', 'confirmed'];

/**
 * One transaction: the newer decision points at the older one, the older becomes
 * superseded, the newer's revision moves past the older's.
 */
export async function supersede(oldId: string, newId: string) {
  if (oldId === newId) throw new ApiError('A decision cannot supersede itself', 400);
  return prisma.$transaction(async (tx) => {
    const old = await tx.decision.findUnique({ where: { id: oldId } });
    const next = await tx.decision.findUnique({ where: { id: newId } });
    if (!old) throw new ApiError('Decision not found', 404);
    if (!next) throw new ApiError('Superseding decision not found', 404);
    if (!SUPERSEDABLE.includes(old.status)) {
      throw new ApiError(`Decision is ${old.status}, cannot be superseded`, 409);
    }
    if (!SUPERSEDABLE.includes(next.status)) {
      throw new ApiError(`Superseding decision is ${next.status}`, 409);
    }
    if (next.supersedes_id && next.supersedes_id !== oldId) {
      throw new ApiError('Superseding decision already supersedes another', 409);
    }
    const already = await tx.decision.findFirst({ where: { supersedes_id: oldId } });
    if (already && already.id !== newId) {
      throw new ApiError('Decision is already superseded', 409);
    }
    await tx.decision.update({ where: { id: oldId }, data: { status: 'superseded' } });
    const updated = await tx.decision.update({
      where: { id: newId },
      data: { supersedes_id: oldId, revision: Math.max(next.revision, old.revision + 1) },
      include: DECISION_INCLUDE,
    });
    return updated;
  });
}

// ---- import ----

export type ImportItem = z.infer<typeof importItemSchema>;

function dataFromItem(item: ImportItem) {
  return {
    title: item.title,
    text: item.text,
    kind: item.kind,
    scope: item.scope,
    lane: item.lane ?? null,
    client_id: item.client_id ?? null,
    project_id: item.project_id ?? null,
    charter_id: item.charter_id ?? null,
    site_id: item.site_id ?? null,
    accord_id: item.accord_id ?? null,
    author_user_id: item.author_user_id ?? null,
    author_contact_id: item.author_contact_id ?? null,
    ruled_at: item.ruled_at ?? null,
    conflict_note: item.conflict_note ?? null,
    confidence: item.confidence ?? null,
    tags: item.tags,
  };
}

export interface ImportResult {
  key: string;
  id: string;
  outcome: 'created' | 'updated' | 'unchanged';
}

/**
 * Idempotent by key. A re-run with the same items changes nothing. Existing rows keep
 * their status (a confirm, reject or retract made in the app is never undone by a re-import);
 * only content, sources and links are refreshed.
 */
export async function importDecisions(items: ImportItem[], userId: string) {
  const results: ImportResult[] = [];
  const idByKey = new Map<string, string>();

  for (const item of items) {
    const existing = await prisma.decision.findUnique({ where: { key: item.key } });
    const data = dataFromItem(item);
    let id: string;
    let outcome: ImportResult['outcome'];

    if (!existing) {
      const created = await prisma.decision.create({
        data: {
          ...data,
          key: item.key,
          status: item.status,
          created_by_id: userId,
          ...(item.status === 'confirmed' ? { confirmed_by_user_id: userId, confirmed_at: new Date() } : {}),
        },
      });
      id = created.id;
      outcome = 'created';
    } else {
      id = existing.id;
      const changed =
        existing.title !== data.title ||
        existing.text !== data.text ||
        existing.kind !== data.kind ||
        existing.scope !== data.scope ||
        (existing.lane ?? null) !== data.lane ||
        (existing.conflict_note ?? null) !== data.conflict_note;
      const open = existing.status === 'proposed' || existing.status === 'recorded_from_source' || existing.status === 'confirmed';
      if (changed && open) {
        await prisma.decision.update({ where: { id }, data });
        outcome = 'updated';
      } else {
        outcome = 'unchanged';
      }
    }

    let added = 0;
    if (item.sources.length) {
      const r = await prisma.decisionSource.createMany({
        data: item.sources.map((src) => ({
          decision_id: id,
          kind: src.kind,
          ref: src.ref,
          thread_ref: src.thread_ref ?? null,
          quote: src.quote ?? null,
          author_label: src.author_label ?? null,
          author_user_id: src.author_user_id ?? null,
          author_contact_id: src.author_contact_id ?? null,
          at: src.at ?? null,
          extracted_by: src.extracted_by ?? null,
        })),
        skipDuplicates: true,
      });
      added += r.count;
    }
    if (item.links.length) {
      const r = await prisma.decisionLink.createMany({
        data: item.links.map((l) => ({
          decision_id: id,
          entity_kind: l.entity_kind,
          entity_id: l.entity_id,
          relation: l.relation,
        })),
        skipDuplicates: true,
      });
      added += r.count;
    }
    if (outcome === 'unchanged' && added > 0) outcome = 'updated';

    idByKey.set(item.key, id);
    results.push({ key: item.key, id, outcome });
  }

  // Supersession pass: both rows now exist. Skip pairs already linked.
  const superseded: Array<{ key: string; supersedes_key: string }> = [];
  for (const item of items) {
    if (!item.supersedes_key) continue;
    const newId = idByKey.get(item.key)!;
    const oldRow = idByKey.has(item.supersedes_key)
      ? { id: idByKey.get(item.supersedes_key)! }
      : await prisma.decision.findUnique({ where: { key: item.supersedes_key }, select: { id: true } });
    if (!oldRow) throw new ApiError(`supersedes_key not found: ${item.supersedes_key}`, 400);
    const current = await prisma.decision.findUnique({ where: { id: newId }, select: { supersedes_id: true } });
    if (current?.supersedes_id === oldRow.id) continue;
    await supersede(oldRow.id, newId);
    superseded.push({ key: item.key, supersedes_key: item.supersedes_key });
  }

  return {
    created: results.filter((r) => r.outcome === 'created').length,
    updated: results.filter((r) => r.outcome === 'updated').length,
    unchanged: results.filter((r) => r.outcome === 'unchanged').length,
    superseded,
    results,
  };
}
