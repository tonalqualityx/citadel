/**
 * Work stage D: the keys of the linking model. Pure.
 *
 * A target is a piece of work: `project:<uuid>` or `task:<uuid>`. A source is what attaches to it: a kind and a ref (an email
 * conversation key, a session external id, an outbox id, a deploy id, sha@repo, a calendar event id, a wait id, a folder path).
 */

export const WORK_KINDS = ['email', 'session', 'send', 'deploy', 'commit', 'calendar', 'wait', 'folder'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
export const isWorkKind = (v: unknown): v is WorkKind => typeof v === 'string' && (WORK_KINDS as readonly string[]).includes(v);

/** Kinds that can attach to several targets at once (a session works in more than one project). Every other kind attaches once. */
export const MULTI_TARGET_KINDS: readonly WorkKind[] = ['session'];

/** The placeholder target of a question row (a proposed link waits there until he answers). */
export const PROPOSED_TARGET = 'proposed';

export const REF_MAX = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type TargetType = 'project' | 'task';
export interface ParsedTarget {
  type: TargetType;
  id: string;
}

export function parseTargetKey(key: unknown): ParsedTarget | null {
  if (typeof key !== 'string') return null;
  const i = key.indexOf(':');
  if (i <= 0) return null;
  const type = key.slice(0, i);
  const id = key.slice(i + 1).toLowerCase();
  if ((type !== 'project' && type !== 'task') || !UUID_RE.test(id)) return null;
  return { type, id };
}

export const targetKeyOf = (type: TargetType, id: string): string => `${type}:${id.toLowerCase()}`;

/** `email:<ref>` and so on: the one string a source is known by in a map. */
export const sourceKeyOf = (kind: WorkKind, ref: string): string => `${kind}:${ref}`;

/** An RFC Message-ID or conversation key the way the machine stores it: lowercase, no angle brackets, no spaces. */
export function normalizeRfc(v: string | null | undefined): string | null {
  const t = (v ?? '').trim().replace(/^<|>$/g, '').trim().toLowerCase();
  return t === '' ? null : t;
}

export interface AskKeyFacts {
  conversation_key: string | null;
  rfc_message_id: string | null;
  message_id: string;
}

/** The ref an email conversation is linked under: its conversation key, else the message's RFC id, else the mailbox message id. */
export function emailRefOfAsk(a: AskKeyFacts): string {
  return normalizeRfc(a.conversation_key) ?? normalizeRfc(a.rfc_message_id) ?? a.message_id;
}

export const clip = (s: string | null | undefined, n: number): string => (s ?? '').slice(0, n);
