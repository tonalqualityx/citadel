/**
 * Engagement briefs (Fleet item 1): the shapes a brief carries and how its scope resolves to tasks.
 *
 * A brief names one engagement (a project or a charter) and what an owner pass may do about it.
 * Scope is data, so a client with 226 open tasks and a charter of three is defined once, with the
 * exclusions written down and a reason beside each.
 *
 *   scope = {
 *     client_id?, charter_ids?, project_ids?,         // defaults: the brief's own columns
 *     include_client_tasks_without_project?: boolean, // the client's tasks that hang off no project
 *     include_retainer_projects?: boolean,            // the client's is_retainer projects
 *     exclude?: { project_ids?, task_ids?, tags?, reasons?: [{ what, why }] },
 *   }
 */

import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import path from 'node:path';

export const OWNER_MODES = ['off', 'dry', 'live'] as const;
export const ENGAGEMENT_ACTIONS = ['close', 'file_task', 'comment_internal', 'mike_item', 'note'] as const;
export const OPEN_TASK_STATUSES = ['not_started', 'in_progress', 'review', 'blocked'] as const;

const uuid = z.string().uuid();

export const scopeSchema = z
  .object({
    client_id: uuid.nullable().optional(),
    charter_ids: z.array(uuid).max(50).optional(),
    project_ids: z.array(uuid).max(200).optional(),
    include_client_tasks_without_project: z.boolean().optional(),
    include_retainer_projects: z.boolean().optional(),
    exclude: z
      .object({
        project_ids: z.array(uuid).max(200).optional(),
        task_ids: z.array(uuid).max(1000).optional(),
        tags: z.array(z.string().max(50)).max(50).optional(),
        reasons: z.array(z.object({ what: z.string().max(300), why: z.string().max(600) })).max(100).optional(),
      })
      .optional(),
  })
  .strict();
export type EngagementScope = z.infer<typeof scopeSchema>;

export const stallRulesSchema = z
  .object({
    not_started_bd: z.number().int().min(1).max(60).optional(),
    in_progress_bd: z.number().int().min(1).max(60).optional(),
    blocked_resolved_bd: z.number().int().min(1).max(60).optional(),
    review_approved_bd: z.number().int().min(1).max(60).optional(),
    /** A pass opens at most this many stall waits per brief, so a stale backlog cannot flood the ladder. */
    max_new_per_pass: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type StallRules = z.infer<typeof stallRulesSchema>;

/**
 * A source is a free-form record with a `kind`. Four kinds carry meaning to the owner pass:
 *   file     { path }                      read-only excerpt, under the Wright clients or ops docs folders
 *   repo     { path }                      a git repo whose commits may count as close evidence
 *   domain   { host }                      a site whose pages may count as close evidence
 *   contacts { addresses[], domains[] }    people to pull mail state for (30 days, read-only mirror)
 *   threads  { ids[] }                     Gmail thread ids of open asks
 * Other kinds are pointers the pass cannot read.
 */
const REPO_ROOTS = ['/home/mike/Documents', '/home/mike/.openclaw/workspace'];
export function repoPathOk(p: string): boolean {
  const n = path.posix.normalize(p);
  return !p.split('/').includes('..') && REPO_ROOTS.some((r) => n.startsWith(r + '/') && n.length > r.length + 1);
}
export function domainOk(h: string): boolean {
  return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(h.trim().replace(/^\./, ''));
}

const sourceSchema = z.record(z.string(), z.unknown()).superRefine((s, ctx) => {
  const strs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0 && x.length < 300);
  const bad = (m: string) => ctx.addIssue({ code: 'custom', message: m });
  if (s.kind === 'contacts' && !(strs(s.addresses ?? []) && strs(s.domains ?? []))) bad('contacts needs addresses[] and domains[] of strings');
  if (s.kind === 'threads' && !strs(s.ids)) bad('threads needs ids[] of strings');
  if ((s.kind === 'repo' || s.kind === 'file') && typeof s.path !== 'string') bad(`${String(s.kind)} needs a path`);
  if (s.kind === 'repo' && typeof s.path === 'string' && !repoPathOk(s.path)) {
    bad('a repo must sit under /home/mike/Documents or /home/mike/.openclaw/workspace, and not be either of them');
  }
  if (s.kind === 'domain' && !(typeof s.host === 'string' && domainOk(s.host))) bad('a domain needs a real host name with at least one dot');
});

export const ROLE_KEYS = ['pm', 'design', 'content', 'liaison', 'wordpress', 'billing', 'social'] as const;

export const briefInputSchema = z
  .object({
    client_id: uuid.nullable().optional(),
    project_id: uuid.nullable().optional(),
    charter_id: uuid.nullable().optional(),
    label: z.string().min(1).max(120),
    goal: z.string().max(5000).optional(),
    sources: z.array(sourceSchema).max(100).optional(),
    scope: scopeSchema.optional(),
    allowed_actions: z.array(z.enum(ENGAGEMENT_ACTIONS)).max(10).optional(),
    release_owner_role: z.enum(ROLE_KEYS).optional(),
    stall_rules: stallRulesSchema.optional(),
    owner_mode: z.enum(OWNER_MODES).optional(),
    cadence: z.string().min(1).max(40).optional(),
  })
  .refine((b) => !!b.project_id || !!b.charter_id, { message: 'A brief needs a project_id or a charter_id.' });
export type BriefInput = z.infer<typeof briefInputSchema>;

export interface BriefLike {
  client_id: string | null;
  project_id: string | null;
  charter_id: string | null;
  scope: unknown;
}

/** Reads the stored scope Json defensively: a bad row yields an empty scope, never a throw. */
export function parseScope(raw: unknown): EngagementScope {
  const r = scopeSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

export function parseStallRules(raw: unknown): StallRules {
  const r = stallRulesSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

/**
 * The Prisma filter for "tasks this brief owns" (open or not; callers add a status filter).
 * Returns null when the scope names nothing, so an empty brief matches no tasks.
 *
 * NOT-IN on a nullable column drops the NULL rows in SQL, so each exclusion is written as
 * "null OR not in".
 */
export function scopeWhere(brief: BriefLike): Prisma.TaskWhereInput | null {
  const scope = parseScope(brief.scope);
  const clientId = scope.client_id ?? brief.client_id ?? null;
  const charterIds = scope.charter_ids ?? (brief.charter_id ? [brief.charter_id] : []);
  const projectIds = scope.project_ids ?? (brief.project_id ? [brief.project_id] : []);

  const includes: Prisma.TaskWhereInput[] = [];
  if (charterIds.length) includes.push({ charter_id: { in: charterIds } });
  if (projectIds.length) includes.push({ project_id: { in: projectIds } });
  if (clientId && scope.include_client_tasks_without_project) {
    includes.push({ client_id: clientId, project_id: null });
  }
  if (clientId && scope.include_retainer_projects) {
    includes.push({ client_id: clientId, project: { is: { is_retainer: true } } });
  }
  if (!includes.length) return null;

  const and: Prisma.TaskWhereInput[] = [{ OR: includes }];
  const ex = scope.exclude;
  if (ex?.project_ids?.length) and.push({ OR: [{ project_id: null }, { project_id: { notIn: ex.project_ids } }] });
  if (ex?.task_ids?.length) and.push({ id: { notIn: ex.task_ids } });
  if (ex?.tags?.length) and.push({ NOT: { tags: { hasSome: ex.tags } } });
  return { is_deleted: false, AND: and };
}
