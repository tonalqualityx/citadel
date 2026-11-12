/**
 * Home screen Slice 1: item keys and group keys.
 *
 * An item key names one thing on Mike's plate across loads, so home_item_state,
 * home_day.quick_item_keys / step_item_keys and home_actions.item_key all agree. A group key
 * names the arc, client, project or own-work group that Today proposes.
 *
 * Item keys (plan 1.1), at most 300 characters (home_item_state.item_key is VarChar(300)):
 *   task:<task uuid>
 *   review:<project uuid> | review:none          one sign-off per project
 *   session:<OracleSession.external_id>          the rest of the key, may hold ':'
 *   wait:<wait uuid>
 *   thread:<EmailAsk.account>:<thread id>        account has no ':'; the thread id is the rest
 *   crisis:<email ask uuid>
 *   site:<site uuid>                              Slice 6a: a site that is down
 *   hands:week                                   Slice 6a: the Monday "This week's hands" row
 *   step:<project uuid>                          Slice 8b: the next step of one project
 *   proposal:<change uuid>                       Slice 9a: a card from his sent mail (home_reconcile_change)
 *   finished:all | finished:<item uuid>          Work stage G: the looks-finished card, and one of its rows (work_finished_item)
 *   attach:<work_link uuid>                      Work stage D: the one question about which work a source belongs to
 *
 * Group keys, at most 120 characters (home_day.group_key is VarChar(120)):
 *   arc:<arc uuid> | client:<client uuid> | project:<project uuid> | own
 *
 * Keys are canonical: uuids are lowercase, no whitespace or control characters anywhere,
 * and parse(build(x)) round-trips exactly. Anything else is rejected (parse returns null,
 * build throws), so a key from a request body can be trusted once it parses.
 */

import { z } from 'zod';
import type { HomeSourceKind } from './types';

export const ITEM_KEY_MAX_LENGTH = 300;
export const GROUP_KEY_MAX_LENGTH = 120;
/** EmailAsk.account, OracleSession.external_id and EmailAsk.thread_id are VarChar(255). */
const PART_MAX_LENGTH = 255;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Any whitespace or control character makes a key invalid.
const BAD_CHAR_RE = /[\s\u0000-\u001f\u007f]/;

export const ITEM_KEY_PREFIXES: readonly HomeSourceKind[] = ['task', 'review', 'session', 'wait', 'thread', 'crisis', 'site', 'hands', 'step', 'proposal', 'finished', 'attach'];

export type ParsedItemKey =
  | { kind: 'task'; id: string }
  | { kind: 'review'; project_id: string | null }
  | { kind: 'session'; external_id: string }
  | { kind: 'wait'; id: string }
  | { kind: 'thread'; account: string; thread_id: string }
  | { kind: 'crisis'; id: string }
  | { kind: 'site'; id: string }
  | { kind: 'hands' }
  | { kind: 'step'; project_id: string }
  | { kind: 'proposal'; id: string }
  | { kind: 'finished'; id: string | null; /** Work stage E: a session's own card, `finished:s-<16 hex>`. */ card?: string }
  | { kind: 'attach'; id: string };

export type ParsedGroupKey =
  | { kind: 'arc'; id: string }
  | { kind: 'client'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'own' };

export const OWN_GROUP_KEY = 'own';
/** Work stage G: the one looks-finished card is `finished:all`; each of its rows is `finished:<work_finished_item uuid>`. */
export const FINISHED_CARD_ID = 'all';
export const FINISHED_CARD_KEY = 'finished:all';
/** Work stage E: a session's own looks-done card is `finished:s-<16 hex>` (a hash of its run key). */
const SESSION_CARD_ID_RE = /^s-[0-9a-f]{16}$/;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function isPart(s: string): boolean {
  return s.length > 0 && s.length <= PART_MAX_LENGTH && !BAD_CHAR_RE.test(s);
}

// ============================================================================
// Item keys
// ============================================================================

/** Parse an item key. Returns null for anything that is not a canonical key. */
export function parseItemKey(key: unknown): ParsedItemKey | null {
  if (typeof key !== 'string') return null;
  if (key.length === 0 || key.length > ITEM_KEY_MAX_LENGTH || BAD_CHAR_RE.test(key)) return null;
  const colon = key.indexOf(':');
  if (colon <= 0) return null;
  const prefix = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  switch (prefix) {
    case 'task':
      return isUuid(rest) ? { kind: 'task', id: rest } : null;
    case 'wait':
      return isUuid(rest) ? { kind: 'wait', id: rest } : null;
    case 'crisis':
      return isUuid(rest) ? { kind: 'crisis', id: rest } : null;
    case 'site':
      return isUuid(rest) ? { kind: 'site', id: rest } : null;
    case 'step':
      return isUuid(rest) ? { kind: 'step', project_id: rest } : null;
    case 'proposal':
      return isUuid(rest) ? { kind: 'proposal', id: rest } : null;
    case 'finished':
      if (rest === FINISHED_CARD_ID) return { kind: 'finished', id: null };
      if (SESSION_CARD_ID_RE.test(rest)) return { kind: 'finished', id: null, card: rest };
      return isUuid(rest) ? { kind: 'finished', id: rest } : null;
    case 'attach':
      return isUuid(rest) ? { kind: 'attach', id: rest } : null;
    case 'hands':
      return rest === 'week' ? { kind: 'hands' } : null;
    case 'review':
      if (rest === 'none') return { kind: 'review', project_id: null };
      return isUuid(rest) ? { kind: 'review', project_id: rest } : null;
    case 'session':
      return isPart(rest) ? { kind: 'session', external_id: rest } : null;
    case 'thread': {
      const c = rest.indexOf(':');
      if (c <= 0) return null;
      const account = rest.slice(0, c);
      const threadId = rest.slice(c + 1);
      return isPart(account) && isPart(threadId) ? { kind: 'thread', account, thread_id: threadId } : null;
    }
    default:
      return null;
  }
}

export function isItemKey(key: unknown): key is string {
  return parseItemKey(key) !== null;
}

/** The source kind a key names, or null when it is not a key. */
export function itemKeyKind(key: unknown): HomeSourceKind | null {
  return parseItemKey(key)?.kind ?? null;
}

/** Build an item key. Throws on any part that would not round-trip through parseItemKey. */
export function buildItemKey(parsed: ParsedItemKey): string {
  let key: string;
  switch (parsed.kind) {
    case 'task':
    case 'wait':
    case 'crisis':
    case 'site':
    case 'proposal':
    case 'attach':
      key = `${parsed.kind}:${String(parsed.id).toLowerCase()}`;
      break;
    case 'finished':
      key = `finished:${parsed.id ? String(parsed.id).toLowerCase() : parsed.card ?? FINISHED_CARD_ID}`;
      break;
    case 'hands':
      key = 'hands:week';
      break;
    case 'step':
      key = `step:${String(parsed.project_id).toLowerCase()}`;
      break;
    case 'review':
      key = `review:${parsed.project_id ? String(parsed.project_id).toLowerCase() : 'none'}`;
      break;
    case 'session':
      key = `session:${parsed.external_id}`;
      break;
    case 'thread':
      if (parsed.account.includes(':')) throw new Error('Invalid item key: account may not contain a colon');
      key = `thread:${parsed.account}:${parsed.thread_id}`;
      break;
    default:
      throw new Error('Invalid item key: unknown kind');
  }
  if (!isItemKey(key)) throw new Error(`Invalid item key: ${JSON.stringify(key).slice(0, 80)}`);
  return key;
}

export const taskKey = (id: string): string => buildItemKey({ kind: 'task', id });
export const waitKey = (id: string): string => buildItemKey({ kind: 'wait', id });
export const crisisKey = (id: string): string => buildItemKey({ kind: 'crisis', id });
export const siteKey = (id: string): string => buildItemKey({ kind: 'site', id });
export const HANDS_KEY = 'hands:week';
export const proposalKey = (id: string): string => buildItemKey({ kind: 'proposal', id });
export const stepKey = (projectId: string): string => buildItemKey({ kind: 'step', project_id: projectId });
export const reviewKey = (projectId: string | null): string => buildItemKey({ kind: 'review', project_id: projectId });
export const sessionKey = (externalId: string): string => buildItemKey({ kind: 'session', external_id: externalId });
export const threadKey = (account: string, threadId: string): string =>
  buildItemKey({ kind: 'thread', account, thread_id: threadId });

/** Zod schema for an item key in a request body (H7). */
export const itemKeySchema = z.string().max(ITEM_KEY_MAX_LENGTH).refine(isItemKey, 'Not a home item key');

// ============================================================================
// Group keys
// ============================================================================

export function parseGroupKey(key: unknown): ParsedGroupKey | null {
  if (typeof key !== 'string') return null;
  if (key.length === 0 || key.length > GROUP_KEY_MAX_LENGTH) return null;
  if (key === OWN_GROUP_KEY) return { kind: 'own' };
  const colon = key.indexOf(':');
  if (colon <= 0) return null;
  const prefix = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if (!isUuid(id)) return null;
  if (prefix === 'arc' || prefix === 'client' || prefix === 'project') return { kind: prefix, id };
  return null;
}

export function isGroupKey(key: unknown): key is string {
  return parseGroupKey(key) !== null;
}

export function buildGroupKey(parsed: ParsedGroupKey): string {
  const key = parsed.kind === 'own' ? OWN_GROUP_KEY : `${parsed.kind}:${String(parsed.id).toLowerCase()}`;
  if (!isGroupKey(key)) throw new Error(`Invalid group key: ${JSON.stringify(key).slice(0, 80)}`);
  return key;
}

export const arcGroupKey = (id: string): string => buildGroupKey({ kind: 'arc', id });
export const clientGroupKey = (id: string): string => buildGroupKey({ kind: 'client', id });
export const projectGroupKey = (id: string): string => buildGroupKey({ kind: 'project', id });

/** Zod schema for a group key in a request body (H7). */
export const groupKeySchema = z.string().max(GROUP_KEY_MAX_LENGTH).refine(isGroupKey, 'Not a home group key');
