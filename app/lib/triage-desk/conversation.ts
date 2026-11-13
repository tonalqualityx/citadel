/**
 * A card's conversation with the chat, for a session to read (GET /api/tasks/:id/conversation).
 *
 * WHAT COMES BACK: the card's own conversation (the one conversation per card per owner, BastChatConversation.task_id), as turns in order: who spoke
 * (`mike` or `bast`), when, and the text. Tool-call detail (action and result events), costs and the machine's status notes are left out: only the
 * text events of the two speakers are turns.
 *
 * REDACTION: a turn the daemon has marked redacted stays redacted. The daemon marks one with `payload.redacted === true`, or by replacing the whole text
 * with a bracketed marker such as "[redacted]" or "[removed ...]"; either way the turn comes back with `redacted: true` and `text: null`. On top of that
 * the server removes anything that looks like a credential from the text it returns (a bearer token, a Citadel key, a long key-like value after a
 * word such as key, secret, token or password), because a session reading the chat must never be handed one.
 *
 * THE GENERAL HOME CHAT: its turns are NOT returned. Mike's messages there carry the card that was OPEN when he sent them, which is not the same as the
 * message being about that card, and the daemon does not tie the assistant's replies to a message or a card, so "explicitly about this card" cannot be
 * decided reliably. Rather than guess, only the card conversation is returned and `home_chat` says so.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

type Db = Pick<PrismaClient, 'bastChatConversation' | 'bastChatEvent' | 'bastChatSettings'>;

export const CONVERSATION_DEFAULT_LIMIT = 200;
export const CONVERSATION_MAX_LIMIT = 500;
export const HOME_CHAT_NOTE =
  "The general home chat is not included: a message there carries the card that was open, not proof it was about this card, and its replies are not tied to a card. Only this card's own conversation is returned.";

export interface ConversationTurn {
  seq: number;
  who: 'mike' | 'bast';
  at: string;
  text: string | null;
  redacted?: true;
  /** Mike's message was never picked up (the machine was off); Bast did not see it. */
  not_answered?: true;
}

export interface CardConversation {
  task_id: string;
  conversation: { id: string; status: string; started_at: string; last_message_at: string | null } | null;
  turns: ConversationTurn[];
  last_seq: number;
  has_more: boolean;
  home_chat: { included: false; note: string };
}

const MARKER = /^\s*\[\s*(?:redacted|removed|withheld)[^\]]*\]\s*$/i;

/** Strip credential-looking text. Linear time: every quantifier is bounded. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,512}/gi, 'Bearer [redacted]')
    .replace(/\bcitadel_[A-Za-z0-9_]{8,128}\b/g, '[redacted]')
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,128}\b/g, '[redacted]')
    .replace(/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,255}\b/g, '[redacted]')
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,200}\b/g, '[redacted]')
    .replace(/\b(api[_-]?key|secret|token|passw(?:or)?d|pwd|salt|signature)(\s*[:=]\s*|\s+is\s+)["']?[A-Za-z0-9+/=_-]{16,256}["']?/gi, '$1$2[redacted]');
}

export function turnOf(e: { seq: number; role: string; payload: unknown; created_at: Date; expired_at: Date | null }): ConversationTurn {
  const p = e.payload && typeof e.payload === 'object' ? (e.payload as { text?: unknown; redacted?: unknown }) : {};
  const raw = typeof p.text === 'string' ? p.text : '';
  const redacted = p.redacted === true || MARKER.test(raw);
  const base = { seq: e.seq, who: e.role === 'mike' ? ('mike' as const) : ('bast' as const), at: e.created_at.toISOString() };
  if (redacted) return { ...base, text: null, redacted: true };
  return { ...base, text: scrubSecrets(raw), ...(e.role === 'mike' && e.expired_at ? { not_answered: true as const } : {}) };
}

export async function readCardConversation(taskId: string, opts: { after?: number; limit?: number } = {}, db: Db = prisma): Promise<CardConversation> {
  const after = Number.isInteger(opts.after) && (opts.after as number) > 0 ? (opts.after as number) : 0;
  const limit = Math.min(CONVERSATION_MAX_LIMIT, Math.max(1, Math.trunc(opts.limit ?? CONVERSATION_DEFAULT_LIMIT) || CONVERSATION_DEFAULT_LIMIT));
  const empty: CardConversation = { task_id: taskId, conversation: null, turns: [], last_seq: after, has_more: false, home_chat: { included: false, note: HOME_CHAT_NOTE } };
  const settings = await db.bastChatSettings.findUnique({ where: { id: 1 }, select: { owner_user_id: true } });
  if (!settings?.owner_user_id) return empty;
  const conv = await db.bastChatConversation.findUnique({
    where: { owner_id_task_id: { owner_id: settings.owner_user_id, task_id: taskId } },
    select: { id: true, status: true, created_at: true, last_message_at: true },
  });
  if (!conv) return empty;
  const rows = await db.bastChatEvent.findMany({
    where: { conversation_id: conv.id, kind: 'text', role: { in: ['mike', 'assistant'] }, seq: { gt: after } },
    orderBy: { seq: 'asc' },
    take: limit + 1,
    select: { seq: true, role: true, payload: true, created_at: true, expired_at: true },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    task_id: taskId,
    conversation: { id: conv.id, status: conv.status, started_at: conv.created_at.toISOString(), last_message_at: conv.last_message_at ? conv.last_message_at.toISOString() : null },
    turns: page.map(turnOf),
    last_seq: page.length > 0 ? page[page.length - 1].seq : after,
    has_more: hasMore,
    home_chat: { included: false, note: HOME_CHAT_NOTE },
  };
}
