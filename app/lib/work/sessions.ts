/**
 * Work stage E: sessions, the pure part. Which of a session's commits and delivered files belong to which task, how strong the proof
 * is, and which segment (project folder) an item was made in. No database in here; sessions-store.ts reads the facts and writes.
 *
 * Proof rules (code only, no model):
 *   a commit whose subject names the task's short id (the first 8 characters of its id) is STRONG proof for that task;
 *   a commit whose subject overlaps the task's title by 0.5 or more is MEDIUM proof;
 *   a delivered file whose file name the task's text names is STRONG; one whose name words overlap the title by 0.5 or more is MEDIUM.
 * Strong proof makes a looks-done card. Medium proof only writes a note on the task. Neither ever closes anything: a close needs the
 * owner's yes (close-task) and, for that task, proof recorded by code in this session's window.
 *
 * Each item belongs to the segment (a linked project's folders) it was made in. A session that worked in two projects has proof for
 * each project's own tasks only.
 */

import { displayText } from '@/lib/home/copy';
import { folderContains, normalizeRemote } from './candidates';
import { titleOverlap } from './finished';
import { clip } from './keys';

export const SESSION_ITEM_KINDS = ['commit', 'delivered_file'] as const;
export type SessionItemKind = (typeof SESSION_ITEM_KINDS)[number];
export const TITLE_MATCH_MIN = 0.5;
export const SESSION_EVIDENCE_MAX = 200;
/** The longest span a session's evidence window may cover. */
export const WINDOW_MAX_DAYS = 31;
/** How long a looks-done card for a session that is still open waits for an in-session answer. */
export const SESSION_CARD_DELAY_HOURS = 2;

export type ProofStrength = 'strong' | 'medium';

export interface SessionItem {
  kind: SessionItemKind;
  /** A commit: `<sha>@<repo>`. A file: its path. */
  ref: string;
  at: Date;
  /** A commit: the repository (a path or a remote). */
  repo?: string | null;
  /** A file: its path. */
  path?: string | null;
  cwd: string;
  /** A commit's subject line (an addition to the plan's shape; without it a commit can only match nothing). */
  subject?: string | null;
}

export interface MatchTask {
  id: string;
  title: string;
  /** The task's description and requirements as plain lowercase text (for the file-name check). */
  text: string;
}

export const shortIdOf = (id: string): string => id.slice(0, 8).toLowerCase();

/** True when a subject names the 8 character short id on its own (not inside a longer hex run). */
export function namesShortId(subject: string, id: string): boolean {
  const short = shortIdOf(id);
  return new RegExp(`(?<![0-9a-f])${short}(?![0-9a-f])`, 'i').test(subject);
}

export function baseName(path: string): string {
  const p = path.replace(/\/+$/, '');
  return p.slice(p.lastIndexOf('/') + 1);
}

const stripExt = (n: string): string => n.replace(/\.[A-Za-z0-9]{1,8}$/, '');

/** How an item matches a task, or null. */
export function matchItem(item: SessionItem, task: MatchTask): ProofStrength | null {
  if (item.kind === 'commit') {
    const subject = (item.subject ?? '').trim();
    if (!subject) return null;
    if (namesShortId(subject, task.id)) return 'strong';
    return titleOverlap(subject, task.title) >= TITLE_MATCH_MIN ? 'medium' : null;
  }
  const name = baseName(item.path ?? item.ref).toLowerCase();
  if (name.length < 5) return null;
  if (task.text.includes(name)) return 'strong';
  const words = stripExt(name).replace(/[-_.]+/g, ' ');
  return titleOverlap(words, task.title) >= TITLE_MATCH_MIN ? 'medium' : null;
}

/** A linked project's place: its folders and repository, from the plan folder, the site and where the session was when it attached. */
export interface Segment {
  link_id: string;
  target_key: string;
  project_id: string | null;
  task_id: string | null;
  folders: string[];
  repos: string[];
}

/** Whether an item was made inside a segment's folders (or in its site's repository). */
export function inSegment(item: SessionItem, seg: Pick<Segment, 'folders' | 'repos'>): boolean {
  if (seg.folders.some((f) => folderContains(f, item.cwd) || (item.path ? folderContains(f, item.path) : false) || (item.repo ? folderContains(f, item.repo) : false))) return true;
  const repo = normalizeRemote(item.repo ?? null);
  return !!repo && seg.repos.some((r) => normalizeRemote(r) === repo);
}

export function proofLineOf(item: SessionItem, strength: ProofStrength): string {
  const base = baseName(item.path ?? item.ref);
  if (item.kind === 'commit') {
    const sha = item.ref.split('@')[0].slice(0, 7);
    const repo = baseName(item.repo ?? item.ref.split('@')[1] ?? '');
    const subject = clip(displayText((item.subject ?? '').replace(/[\r\n]+/g, ' ')), 120);
    return `Commit ${displayText(sha)}${repo ? ` in ${displayText(repo)}` : ''}${subject ? `: ${subject}` : ''}${strength === 'medium' ? ' (title overlap)' : ''}`;
  }
  return `File delivered: ${displayText(base)}${strength === 'medium' ? ' (name overlap)' : ''}`;
}

/** The task text the file-name check reads: description and requirements, lowercased, flattened. */
export function plainTaskText(...parts: unknown[]): string {
  const out: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => walk(x, depth + 1));
  };
  parts.forEach((p) => walk(p, 0));
  return out.join(' ').toLowerCase().slice(0, 20_000);
}

/** The short deterministic hash a long session id is shortened to in a key (FNV-1a, two lanes, 16 hex characters). */
export function shortHash(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** The run key of a session's looks-done items (the column holds 80 characters). */
export function sessionRunKey(sessionRef: string): string {
  const k = `session:${sessionRef}`;
  return k.length <= 80 ? k : `session:h-${shortHash(sessionRef)}`;
}

/** The home key of one session's looks-done card: `finished:s-<16 hex>`. */
export const sessionCardKey = (runKey: string): string => `finished:s-${shortHash(runKey)}`;
export const SESSION_CARD_ID_RE = /^s-[0-9a-f]{16}$/;

export function inWindow(at: Date, window: { from: Date; to: Date }): boolean {
  return at.getTime() >= window.from.getTime() && at.getTime() <= window.to.getTime();
}
