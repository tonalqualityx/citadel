/**
 * Work stage D: which piece of work a new source belongs to. Pure: the loader (candidates-store.ts) reads the facts, this decides.
 *
 * Candidates are:
 *   1. the work the conversation is already linked to (basis same_conversation),
 *   2. the sender's client's LIVE projects (ready, in_progress, review; never done, cancelled, quote, queue or suspended, so a
 *      finished project is never reused) (basis client_project),
 *   3. for sessions: a live project whose plan_folder contains the cwd (plan_folder), a site whose repo_url matches the cwd's git
 *      remote (repo_site), or the Wright client folder `.../Wright/clients/<slug>` mapped to a client (client_folder),
 *   4. a folder-to-project choice the owner made before (prior_choice).
 *
 * A clear match attaches quietly: exactly ONE candidate, and its basis is same_conversation, plan_folder or prior_choice. Two or
 * more candidates, or one with any other basis, or a client with no live project, is ONE question. "When in doubt, ask." With no
 * candidate and no client there is nothing to ask and nothing to attach.
 */

import { LIVE_PROJECT_STATUSES } from './links';
import { targetKeyOf } from './keys';

export const QUIET_BASES = ['same_conversation', 'plan_folder', 'prior_choice'] as const;
export type CandidateBasis = (typeof QUIET_BASES)[number] | 'client_project' | 'repo_site' | 'client_folder';

/** Strongest first: when one target is found by two bases, the stronger one is kept. */
const BASIS_ORDER: readonly CandidateBasis[] = ['same_conversation', 'prior_choice', 'plan_folder', 'repo_site', 'client_folder', 'client_project'];

export interface ProjectFacts {
  id: string;
  name: string;
  status: string;
  client_id: string;
  plan_folder: string | null;
  /** repo_url of the project's site, or null. */
  site_repo_url: string | null;
}

export interface TaskTargetFacts {
  id: string;
  title: string;
  status: string;
  project_id: string | null;
}

export interface ExistingTarget {
  target_key: string;
  /** The target's name, and whether it is finished (a finished one is never a candidate). */
  name: string;
  finished: boolean;
}

export interface FolderChoice {
  /** The folder path of the earlier choice. */
  folder: string;
  project: ProjectFacts;
}

export interface CandidateInput {
  /** Where the source is attached now (links and, for mail, the task its asks point at). */
  existing: ExistingTarget[];
  client: { id: string; name: string } | null;
  /** Every non-deleted project of that client (this function drops the ones that are not live). */
  client_projects: ProjectFacts[];
  cwd: string | null;
  repo_remote: string | null;
  /** Live-or-not projects that carry a plan_folder (this function checks live and the path). */
  plan_folder_projects: ProjectFacts[];
  /** Projects whose site has a repo_url. */
  site_repo_projects: ProjectFacts[];
  /** Projects of the client the Wright folder names, if the cwd is under .../Wright/clients/<slug>. */
  folder_client_projects: ProjectFacts[];
  folder_choices: FolderChoice[];
}

export interface Candidate {
  target_key: string;
  label: string;
  basis: CandidateBasis;
}

export type Resolution =
  | { action: 'already'; target: Candidate }
  | { action: 'quiet'; target: Candidate }
  | { action: 'ask'; candidates: Candidate[]; can_new_project: boolean }
  | { action: 'none' };

export const isLiveProject = (p: { status: string }): boolean => (LIVE_PROJECT_STATUSES as readonly string[]).includes(p.status);

/** A path without trailing slashes, lowercase not applied (paths are case sensitive). */
export function cleanPath(p: string | null | undefined): string | null {
  const t = (p ?? '').trim().replace(/\/+$/, '');
  return t === '' ? null : t;
}

/** True when `cwd` is `folder` or inside it (on a path boundary, so /a/foo does not contain /a/foobar). */
export function folderContains(folder: string | null | undefined, cwd: string | null | undefined): boolean {
  const f = cleanPath(folder);
  const c = cleanPath(cwd);
  if (!f || !c) return false;
  return c === f || c.startsWith(`${f}/`);
}

/** A git remote reduced to host/owner/repo, so ssh and https forms of one repository meet. */
export function normalizeRemote(url: string | null | undefined): string | null {
  let t = (url ?? '').trim();
  if (!t) return null;
  t = t.replace(/\/+$/, '').replace(/\.git$/i, '');
  const ssh = t.match(/^[\w.-]+@([^:/]+):(.+)$/);
  if (ssh) return `${ssh[1]}/${ssh[2]}`.toLowerCase();
  t = t.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '');
  return t.toLowerCase() || null;
}

/** The client slug of a Wright client folder (`/home/x/Documents/Wright/clients/<slug>/...`), or null. */
export function wrightClientSlug(cwd: string | null | undefined): string | null {
  const m = (cwd ?? '').match(/\/Wright\/clients\/([^/]+)(?:\/|$)/);
  return m ? m[1].toLowerCase() : null;
}

/** "Thermalnetics Inc." to "thermalnetics": the folder slug the name would carry. */
export function clientSlug(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

export function slugMatchesClient(slug: string, clientName: string): boolean {
  const s = slug.replace(/[^a-z0-9]+/g, '');
  const n = clientSlug(clientName);
  return s !== '' && n !== '' && (n === s || n.startsWith(s) || s.startsWith(n));
}

const rank = (b: CandidateBasis): number => BASIS_ORDER.indexOf(b);

export function candidatesFor(input: CandidateInput): Candidate[] {
  const found = new Map<string, Candidate>();
  const put = (c: Candidate) => {
    const cur = found.get(c.target_key);
    if (!cur || rank(c.basis) < rank(cur.basis)) found.set(c.target_key, c);
  };
  for (const e of input.existing) if (!e.finished) put({ target_key: e.target_key, label: e.name, basis: 'same_conversation' });
  const project = (p: ProjectFacts, basis: CandidateBasis) => {
    if (isLiveProject(p)) put({ target_key: targetKeyOf('project', p.id), label: p.name, basis });
  };
  for (const p of input.client_projects) project(p, 'client_project');
  // A folder the owner chose before: the longest matching folder wins.
  const prior = input.folder_choices.filter((c) => folderContains(c.folder, input.cwd)).sort((a, b) => b.folder.length - a.folder.length)[0];
  if (prior) project(prior.project, 'prior_choice');
  for (const p of input.plan_folder_projects) if (folderContains(p.plan_folder, input.cwd)) project(p, 'plan_folder');
  const remote = normalizeRemote(input.repo_remote);
  if (remote) for (const p of input.site_repo_projects) if (normalizeRemote(p.site_repo_url) === remote) project(p, 'repo_site');
  for (const p of input.folder_client_projects) project(p, 'client_folder');
  return [...found.values()].sort((a, b) => rank(a.basis) - rank(b.basis) || a.label.localeCompare(b.label));
}

export function resolve(input: CandidateInput): Resolution {
  const list = candidatesFor(input);
  const live = list.filter((c) => c.basis === 'same_conversation');
  // The conversation's own home wins over every other candidate: a new message on a linked conversation is never a new question.
  if (live.length > 0) return { action: 'already', target: live[0] };
  if (list.length === 1 && (QUIET_BASES as readonly string[]).includes(list[0].basis)) return { action: 'quiet', target: list[0] };
  if (list.length > 0) return { action: 'ask', candidates: list, can_new_project: !!input.client };
  if (input.client) return { action: 'ask', candidates: [], can_new_project: true };
  return { action: 'none' };
}
