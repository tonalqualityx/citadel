/**
 * Pure helpers that shape project data for the client portal (portal MVP A5).
 *
 * Everything here takes rows that the routes already scoped with access.ts and visibility.ts and
 * returns client-safe fields only. No estimates, no assignees, no tags, no internal notes.
 */
import { filterClientVisible } from '@/lib/comments/visibility';
import { isStagedForApproval } from '@/lib/portal/visibility';
import { taskStatusLabel, type PhaseState } from '@/lib/portal/status-labels';

/** Tag on a task that is waiting on the client for an answer (lib/utils/task-tags.ts). */
export const AWAITING_CLARIFICATION_TAG = 'awaiting-clarification';

export interface ViewTask {
  id: string;
  title: string;
  status: string;
  phase_id?: string | null;
  completed_at?: Date | string | null;
  updated_at?: Date | string | null;
  requested_by_contact_id?: string | null;
  client_visible?: boolean | null;
  staging_preview_url?: string | null;
  approved?: boolean | null;
  client_approved_at?: Date | string | null;
}

/** True when the task is finished on our side and waiting for the client's yes. */
export function isAwaitingClient(task: ViewTask): boolean {
  return !task.client_approved_at && isStagedForApproval(task);
}

/** True when the task counts as complete for progress and phases. */
export function isTaskDone(task: ViewTask): boolean {
  if (isAwaitingClient(task)) return false;
  return task.status === 'done' || Boolean(task.client_approved_at);
}

/** Closed without being done: left out of every count. */
function isAbandoned(task: ViewTask): boolean {
  return task.status === 'abandoned' && !task.client_approved_at;
}

export interface Progress {
  done: number;
  total: number;
}

/** "N of M" as a count only. Abandoned tasks are excluded. Pass client-visible tasks only. */
export function computeProgress(tasks: ViewTask[]): Progress {
  const counted = tasks.filter((t) => !isAbandoned(t));
  return { done: counted.filter(isTaskDone).length, total: counted.length };
}

export interface ViewPhase {
  id: string;
  name: string;
  sort_order: number;
}

export interface PhaseEntry {
  id: string;
  name: string;
  state: PhaseState;
}

/**
 * Phase list with done and current. Only phases that hold at least one client-visible task are
 * listed, so an internal-only phase name never shows. A phase is done when all its counted tasks
 * are done; the first phase that is not done is current; the rest are upcoming.
 */
export function buildPhaseList(phases: ViewPhase[], tasks: ViewTask[]): PhaseEntry[] {
  const ordered = [...phases].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const entries: PhaseEntry[] = [];
  let currentAssigned = false;
  for (const phase of ordered) {
    const own = tasks.filter((t) => t.phase_id === phase.id && !isAbandoned(t));
    if (own.length === 0) continue;
    const allDone = own.every(isTaskDone);
    let state: PhaseState;
    if (allDone) state = 'done';
    else if (!currentAssigned) {
      state = 'current';
      currentAssigned = true;
    } else state = 'upcoming';
    entries.push({ id: phase.id, name: phase.name, state });
  }
  return entries;
}

/** Name of the current phase, or the last one when everything is done, or null with no phases. */
export function currentPhaseName(entries: PhaseEntry[]): string | null {
  const current = entries.find((e) => e.state === 'current');
  if (current) return current.name;
  return entries.length ? entries[entries.length - 1].name : null;
}

/** Client-safe task row for lists. */
export function toClientTask(task: ViewTask, phaseName: string | null = null) {
  const awaiting = isAwaitingClient(task);
  return {
    id: task.id,
    title: task.title,
    status_label: taskStatusLabel(task.status, awaiting),
    is_done: isTaskDone(task),
    awaiting_you: awaiting,
    phase: phaseName,
    completed_at: task.client_approved_at ?? task.completed_at ?? null,
  };
}

export interface AskComment {
  content: string;
  created_at: Date | string;
  is_internal?: boolean;
}

/** Newest client-visible comment text, or null. Internal notes are never returned. */
export function latestClientComment(comments: AskComment[] | undefined): { content: string; at: Date | string } | null {
  const visible = filterClientVisible(comments ?? []);
  if (visible.length === 0) return null;
  const newest = [...visible].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  return { content: newest.content, at: newest.created_at };
}

/** A request for the client: a task waiting on their answer, with the newest client-visible comment. */
export function toClientRequest(task: { id: string; title: string; comments?: AskComment[] }) {
  const latest = latestClientComment(task.comments);
  return {
    task_id: task.id,
    title: task.title,
    question: latest?.content ?? null,
    asked_at: latest?.at ?? null,
  };
}

// ---- links ----------------------------------------------------------------------------------

export type ClientLinkKind = 'review' | 'upload' | 'preview';

export interface ResourceLinkRow {
  name: string;
  url: string;
  icon?: string | null;
}

/** Only http(s) URLs are ever shown to a client. */
export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * ResourceLinks are internal by default (Figma, GitHub, Drive working folders). A link reaches the
 * client only when it is explicitly marked for them: icon `review` or `upload`, or a name that
 * starts with "Review" or "Upload". Review-surface links must carry no per-person token.
 */
export function classifyResourceLink(link: ResourceLinkRow): ClientLinkKind | null {
  if (!isHttpUrl(link.url)) return null;
  const icon = (link.icon ?? '').toLowerCase();
  const name = link.name.trim().toLowerCase();
  if (icon === 'review' || name.startsWith('review')) return 'review';
  if (icon === 'upload' || name.startsWith('upload')) return 'upload';
  return null;
}

export interface ClientLink {
  name: string;
  url: string;
  kind: ClientLinkKind;
}

export function toClientLinks(links: ResourceLinkRow[]): ClientLink[] {
  const out: ClientLink[] = [];
  for (const link of links) {
    const kind = classifyResourceLink(link);
    if (kind) out.push({ name: link.name, url: link.url, kind });
  }
  return out;
}

/** First review-surface link, or null. */
export function reviewLink(links: { url: string; kind: ClientLinkKind }[]): string | null {
  return links.find((l) => l.kind === 'review')?.url ?? null;
}
