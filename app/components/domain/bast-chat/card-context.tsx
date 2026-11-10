/**
 * The open card, as the panel knows it. The title is for the "About:" line only and never leaves the browser;
 * only `kind` and `id` travel with a message (plan 2.1, "How the open card is sent"). Citadel validates the id.
 */

export type BastChatCardKind = 'task' | 'email_ask' | 'wait' | 'project' | 'arc' | 'session_ask' | 'none';

export interface BastChatCard {
  /** The home screen's item key, "task:<uuid>" and the like. Used to tell one card from the next. */
  key: string;
  title: string;
  kind: BastChatCardKind;
  id?: string;
  tile?: string;
}

/** What the home screen hands the dock: the item or row that is open. */
export interface OpenCardInput {
  key: string;
  title: string;
  /** HomeItem.type, when the card is an item. */
  type?: string;
  /** HomeItem.opened.task_id, when there is one. */
  task_id?: string | null;
  tile?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string | undefined | null): s is string => typeof s === 'string' && UUID_RE.test(s);

/** Turns an open home card into the kind and id Citadel understands. Anything unclear becomes kind "none". */
export function cardFromInput(input: OpenCardInput | null | undefined): BastChatCard | null {
  if (!input || !input.key || !input.title) return null;
  const base = { key: input.key, title: input.title, tile: input.tile };
  const sep = input.key.indexOf(':');
  const prefix = sep > 0 ? input.key.slice(0, sep) : '';
  const rest = sep > 0 ? input.key.slice(sep + 1) : input.key;
  if (prefix === 'task' && isUuid(rest)) return { ...base, kind: 'task', id: rest };
  if (isUuid(input.task_id) && (input.type === 'task' || prefix === '')) return { ...base, kind: 'task', id: input.task_id };
  if (prefix === 'wait' && isUuid(rest)) return { ...base, kind: 'wait', id: rest };
  if (prefix === 'crisis' && isUuid(rest)) return { ...base, kind: 'email_ask', id: rest };
  if (prefix === 'review' && isUuid(rest)) return { ...base, kind: 'project', id: rest };
  if (prefix === 'session' && isUuid(rest)) return { ...base, kind: 'session_ask', id: rest };
  // A bare uuid key is a project row (the Projects tile).
  if (prefix === '' && isUuid(rest)) return { ...base, kind: 'project', id: rest };
  return { ...base, kind: 'none' };
}

/** The `context` field of a message. Only kind, id and where on the screen; never any card text. */
export function contextFor(card: BastChatCard | null | undefined): { screen: 'home'; tile?: string; kind: BastChatCardKind; id?: string } {
  if (!card || card.kind === 'none' || !card.id) return { screen: 'home', kind: 'none' };
  return { screen: 'home', ...(card.tile ? { tile: card.tile } : {}), kind: card.kind, id: card.id };
}
