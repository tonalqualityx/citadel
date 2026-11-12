/**
 * Work stage D: reads the facts candidates.ts decides from. Read only. One function, resolveSource, for the route, the intake and the
 * home screen's own checks, so every caller sees the same candidates.
 */

import type { HomeDb } from '@/lib/home/state';
import { activeLinks, emailAskWhere, FINISHED_TASK_STATUSES, FINISHED_PROJECT_STATUSES, LIVE_PROJECT_STATUSES } from './links';
import { resolve, slugMatchesClient, wrightClientSlug, type ExistingTarget, type FolderChoice, type ProjectFacts, type Resolution } from './candidates';
import { targetKeyOf, type WorkKind } from './keys';

export interface SourceFacts {
  kind: WorkKind;
  ref: string;
  /** The client, when the caller knows it (the classifier knows the sender's). Otherwise read from the asks. */
  client_id?: string | null;
  cwd?: string | null;
  repo_remote?: string | null;
  /** Work stage E: a session that works in several projects is judged by where it is now, not by the project it already has. */
  ignore_existing?: boolean;
}

export interface ResolvedSource {
  resolution: Resolution;
  client: { id: string; name: string } | null;
  /** Who the source is from, and its title, for the question and the line. */
  who: string | null;
  title: string | null;
  href: string | null;
  /** The client's only site, for a new project. */
  site_id: string | null;
  at: Date | null;
}

const PROJECT_SELECT = { id: true, name: true, status: true, client_id: true, plan_folder: true, site: { select: { repo_url: true } } } as const;
type ProjectRow = { id: string; name: string; status: string; client_id: string; plan_folder: string | null; site: { repo_url: string | null } | null };
const toFacts = (p: ProjectRow): ProjectFacts => ({ id: p.id, name: p.name, status: p.status, client_id: p.client_id, plan_folder: p.plan_folder, site_repo_url: p.site?.repo_url ?? null });

export async function resolveSource(db: HomeDb, s: SourceFacts): Promise<ResolvedSource> {
  let clientId = s.client_id ?? null;
  let who: string | null = null;
  let title: string | null = null;
  let href: string | null = null;
  let at: Date | null = null;
  const existing: ExistingTarget[] = [];

  // Where the source is attached now.
  const links = s.ignore_existing ? [] : await activeLinks(db, s.kind, s.ref);
  const taskIds = links.map((l) => l.task_id).filter((x): x is string => !!x);
  const projectIds = links.filter((l) => !l.task_id && l.project_id).map((l) => l.project_id as string);

  if (s.kind === 'email') {
    const asks = await db.emailAsk.findMany({
      where: emailAskWhere(s.ref),
      select: { from_name: true, from_email: true, subject: true, deep_link: true, received_at: true, client_id: true, task_id: true },
      orderBy: { received_at: 'desc' },
      take: 50,
    });
    if (asks[0]) {
      who = asks[0].from_name || asks[0].from_email;
      title = asks[0].subject;
      href = asks[0].deep_link;
      at = asks[0].received_at;
    }
    if (!clientId) clientId = asks.find((a) => a.client_id)?.client_id ?? null;
    if (!clientId && asks[0]) {
      const c = await db.clientContact.findFirst({ where: { is_deleted: false, email: { equals: asks[0].from_email, mode: 'insensitive' } }, select: { client_id: true } });
      clientId = c?.client_id ?? null;
    }
    // Legacy: the task an ask already points at (Stage A's field), link or no link.
    for (const a of asks) if (a.task_id) taskIds.push(a.task_id);
  } else if (s.kind === 'session') {
    const sess = await db.oracleSession.findFirst({ where: { external_id: s.ref }, select: { title: true, remote_url: true, last_event_at: true, cwd: true, arc: { select: { client_id: true } } }, orderBy: { last_event_at: 'desc' } });
    if (sess) {
      title = sess.title;
      who = sess.title;
      href = sess.remote_url;
      at = sess.last_event_at;
      if (!clientId) clientId = sess.arc?.client_id ?? null;
      if (!s.cwd && sess.cwd) s = { ...s, cwd: sess.cwd };
    }
  }

  const [tasks, projects] = await Promise.all([
    taskIds.length ? db.task.findMany({ where: { id: { in: Array.from(new Set(taskIds)) }, is_deleted: false }, select: { id: true, title: true, status: true } }) : Promise.resolve([]),
    projectIds.length ? db.project.findMany({ where: { id: { in: projectIds }, is_deleted: false }, select: { id: true, name: true, status: true } }) : Promise.resolve([]),
  ]);
  for (const t of tasks) existing.push({ target_key: targetKeyOf('task', t.id), name: t.title, finished: (FINISHED_TASK_STATUSES as readonly string[]).includes(t.status) });
  for (const p of projects) existing.push({ target_key: targetKeyOf('project', p.id), name: p.name, finished: (FINISHED_PROJECT_STATUSES as readonly string[]).includes(p.status) });

  const client = clientId ? await db.client.findFirst({ where: { id: clientId, is_deleted: false }, select: { id: true, name: true } }) : null;
  const live = { in: [...LIVE_PROJECT_STATUSES] as never };

  const clientProjects = client ? (await db.project.findMany({ where: { client_id: client.id, is_deleted: false }, select: PROJECT_SELECT, orderBy: { name: 'asc' } })).map(toFacts) : [];

  let planFolder: ProjectFacts[] = [];
  let siteRepo: ProjectFacts[] = [];
  let folderClient: ProjectFacts[] = [];
  let choices: FolderChoice[] = [];
  if (s.cwd) {
    planFolder = (await db.project.findMany({ where: { is_deleted: false, status: live, plan_folder: { not: null } }, select: PROJECT_SELECT })).map(toFacts);
    if (s.repo_remote) siteRepo = (await db.project.findMany({ where: { is_deleted: false, status: live, site: { repo_url: { not: null } } }, select: PROJECT_SELECT })).map(toFacts);
    const slug = wrightClientSlug(s.cwd);
    if (slug) {
      const clients = await db.client.findMany({ where: { is_deleted: false }, select: { id: true, name: true } });
      const hit = clients.filter((c) => slugMatchesClient(slug, c.name));
      if (hit.length === 1) folderClient = (await db.project.findMany({ where: { client_id: hit[0].id, is_deleted: false, status: live }, select: PROJECT_SELECT })).map(toFacts);
    }
    const folderLinks = await db.workLink.findMany({ where: { kind: 'folder', state: 'active', project_id: { not: null }, task_id: null }, select: { ref: true, project_id: true } });
    if (folderLinks.length > 0) {
      const ps = new Map((await db.project.findMany({ where: { id: { in: folderLinks.map((l) => l.project_id as string) }, is_deleted: false }, select: PROJECT_SELECT })).map((p) => [p.id, toFacts(p)]));
      choices = folderLinks.flatMap((l) => (ps.get(l.project_id as string) ? [{ folder: l.ref, project: ps.get(l.project_id as string) as ProjectFacts }] : []));
    }
  }

  let siteId: string | null = null;
  if (client) {
    const sites = await db.site.findMany({ where: { client_id: client.id, is_deleted: false }, select: { id: true }, take: 2 });
    siteId = sites.length === 1 ? sites[0].id : null;
  }

  const resolution = resolve({
    existing,
    client,
    client_projects: clientProjects,
    cwd: s.cwd ?? null,
    repo_remote: s.repo_remote ?? null,
    plan_folder_projects: planFolder,
    site_repo_projects: siteRepo,
    folder_client_projects: folderClient,
    folder_choices: choices,
  });
  return { resolution, client, who, title, href, site_id: siteId, at };
}
