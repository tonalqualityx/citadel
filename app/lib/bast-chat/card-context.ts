/**
 * Bast chat: the open card sent with a message, validated to a small fixed shape.
 *
 * What the browser may send: `{screen?, tile?, kind, id?, task_id?, title?}` and nothing else. Any other key is a
 * validation error (strict), so options, HTML or instructions cannot ride along. `kind` comes from a fixed list,
 * ids are uuids (or a short safe token for a session ask), `tile` is a short lowercase token, and `title` is
 * stripped of control characters and angle brackets, dashes turned into commas, and cut to 120 characters.
 *
 * The stored shape is the same small object. The worker inbox serves only `{screen, tile, kind, id}`
 * (see `contextForWorker`); the title is for the panel and never reaches the model.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';

export const CARD_KINDS = ['task', 'email_ask', 'wait', 'project', 'arc', 'session_ask', 'none'] as const;
export const CARD_SCREENS = ['home', 'overlook'] as const;
export const CARD_TITLE_MAX = 120;

export type CardKind = (typeof CARD_KINDS)[number];

export interface CardContext {
  screen?: (typeof CARD_SCREENS)[number];
  tile?: string;
  kind: CardKind;
  id?: string;
  task_id?: string;
  title?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;

/**
 * Plain one-line text: no control characters, no invisible or direction-control characters (Unicode Cf: zero-width,
 * bidi embeddings and overrides, the byte order mark), no angle brackets, no em or en dash, single spaces, cut to `max`.
 */
export function cleanLine(input: string, max: number): string {
  return input
    .replace(/\p{Cf}/gu, '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029<>]/g, ' ')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

const schema = z
  .object({
    screen: z.enum(CARD_SCREENS).optional(),
    tile: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
    kind: z.enum(CARD_KINDS),
    id: z.string().max(120).optional(),
    task_id: z.string().regex(UUID_RE).optional(),
    title: z.string().max(2000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'none') return;
    const ok = v.id !== undefined && (v.kind === 'session_ask' ? SESSION_ID_RE.test(v.id) : UUID_RE.test(v.id));
    if (!ok) ctx.addIssue({ code: 'custom', path: ['id'], message: 'A card needs a valid id' });
  });

/**
 * Parse the card the browser sent. Missing means `{kind: 'none'}`. Throws a ZodError (400 in handleApiError)
 * on an extra key, an unknown kind, a bad id or a wrong type. Lower-cases uuids.
 */
export function parseCardContext(raw: unknown): CardContext {
  if (raw === undefined || raw === null) return { kind: 'none' };
  const v = schema.parse(raw);
  if (v.kind === 'none') return { ...(v.screen ? { screen: v.screen } : {}), ...(v.tile ? { tile: v.tile } : {}), kind: 'none' };
  const title = v.title !== undefined ? cleanLine(v.title, CARD_TITLE_MAX) : '';
  return {
    ...(v.screen ? { screen: v.screen } : {}),
    ...(v.tile ? { tile: v.tile } : {}),
    kind: v.kind,
    id: v.kind === 'session_ask' ? v.id : v.id!.toLowerCase(),
    ...(v.task_id ? { task_id: v.task_id.toLowerCase() } : {}),
    ...(title ? { title } : {}),
  };
}

type CardDb = Pick<PrismaClient, 'task' | 'project' | 'arc' | 'wait' | 'emailAsk'>;

/**
 * `parseCardContext`, then check the card exists for its kind. A card that does not exist is stored as
 * `{kind: 'none'}` (the screen and tile are kept). A session ask has no uuid to look up and is kept as sent.
 */
export async function resolveCardContext(raw: unknown, db: CardDb = defaultDb): Promise<CardContext> {
  const card = parseCardContext(raw);
  if (card.kind === 'none' || card.kind === 'session_ask') return card;
  const id = card.id!;
  let found = false;
  switch (card.kind) {
    case 'task':
      found = !!(await db.task.findFirst({ where: { id, is_deleted: false }, select: { id: true } }));
      break;
    case 'project':
      found = !!(await db.project.findUnique({ where: { id }, select: { id: true } }));
      break;
    case 'arc':
      found = !!(await db.arc.findUnique({ where: { id }, select: { id: true } }));
      break;
    case 'wait':
      found = !!(await db.wait.findUnique({ where: { id }, select: { id: true } }));
      break;
    case 'email_ask':
      found = !!(await db.emailAsk.findUnique({ where: { id }, select: { id: true } }));
      break;
  }
  if (!found) return { ...(card.screen ? { screen: card.screen } : {}), ...(card.tile ? { tile: card.tile } : {}), kind: 'none' };
  return card;
}

/** What the machine gets: kind and id only (plus screen and tile). Never the title. */
export function contextForWorker(stored: unknown): { screen?: string; tile?: string; kind: CardKind; id?: string } {
  const p = schema.safeParse(stored);
  if (!p.success) return { kind: 'none' };
  const v = p.data;
  return { ...(v.screen ? { screen: v.screen } : {}), ...(v.tile ? { tile: v.tile } : {}), kind: v.kind, ...(v.kind !== 'none' && v.id ? { id: v.id } : {}) };
}
