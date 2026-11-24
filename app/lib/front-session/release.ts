/**
 * The front session's one write: release a Triage card on Mike's words (project "Front session for Bast", 1e374bad;
 * Mike, 2026-11-24: "The bast session will need to be able to release triage cards").
 *
 * The front session is the Bast session Mike talks to from his phone. It takes his direction and files cards; it does no work
 * itself. Its key carries the enforced `front-session` lane, which reaches one route, POST /api/tasks/:id/triage/release. A release
 * goes through only when the request carries Mike's own words, quoted, and where and when he said them (handbook section 5: a
 * relay counts as his yes only when it quotes him and names where and when). Citadel:
 *   1. releases the card exactly as his Release tap does (releaseCard in lib/tasks/triage.ts, run as Mike, so the 72 hour Undo on
 *      his home screen covers it and the release_version check refuses a card that changed since the session read it);
 *   2. records his words on the card: an internal comment quoting him with where and when (written first, so a card never leaves Triage
 *      without it, and taken back out if the release is refused), and after the release a change line naming the front session.
 * A request without the words, from any other caller, or for a card that is not in Triage changes nothing.
 * mayLeaveTriage (lib/services/task-patch.ts) is unchanged: this lane can never move a status through PATCH /api/tasks/:id.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import type { AuthPayload } from '@/lib/auth/middleware';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { releaseCard } from '@/lib/tasks/triage';
import { loadCards } from '@/lib/tasks/triage-card';
import { actorOf, recordTriageChange } from '@/lib/tasks/triage-rev';
import type { HomeActResponse } from '@/lib/home/types';

export const FRONT_SESSION_LANE = 'front-session';
export const FRONT_SESSION_ONLY = "Only the front session's key releases a card this way.";
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/** True for an enforced API key that carries the front-session lane (a stored lane value may be a comma list). */
export function isFrontSessionCaller(auth: Pick<AuthPayload, 'via' | 'lane' | 'laneEnforced'>): boolean {
  if (auth.via !== 'api_key' || auth.laneEnforced !== true) return false;
  return (auth.lane ?? '').split(',').some((l) => l.trim() === FRONT_SESSION_LANE);
}

const text = (max: number, what: string) =>
  z
    .string({ message: `Send ${what}.` })
    .transform((v) => v.trim())
    .pipe(z.string().min(1, `Send ${what}.`).max(max, `${what} is at most ${max} characters.`));

export const releaseOnWordsSchema = z
  .object({
    /** Mike's own words, quoted as he typed them. */
    mike_words: text(2000, "Mike's words"),
    /** Where he said them: "Claude app, front session", "Citadel chat". */
    said_where: text(200, 'where Mike said it'),
    /** When he said them, ISO 8601 with a zone; at most five minutes ahead of the server clock (clock skew). */
    said_at: z.string({ message: 'Send when Mike said it (said_at).' }).datetime({ offset: true, message: 'said_at is an ISO 8601 date and time with a zone.' }),
    /** The card's release_version as the session read it; when left out, the card as it stands now. */
    release_version: z.string().min(8).max(64).optional(),
  })
  .strict();

export type ReleaseOnWords = z.infer<typeof releaseOnWordsSchema>;

/** The comment a release leaves on the card. Plain text; his words are quoted as sent. */
export function wordsComment(input: Pick<ReleaseOnWords, 'mike_words' | 'said_where' | 'said_at'>): string {
  return `Released from Triage by the front session on Mike's words.\n\nMike, ${input.said_where}, ${new Date(input.said_at).toISOString()}:\n"${input.mike_words}"`;
}

export interface ReleaseOnWordsResult {
  release: HomeActResponse;
  comment_id: string;
}

/** The record of Mike's words on the card: an internal comment quoting him with where and when. Written BEFORE the card moves. */
export async function recordWords(db: PrismaClient, taskId: string, auth: AuthPayload, input: ReleaseOnWords): Promise<{ id: string }> {
  return db.comment.create({
    data: { task_id: taskId, user_id: auth.userId, content: wordsComment(input), is_internal: true, client_visible: false, actor_lane: FRONT_SESSION_LANE },
    select: { id: true },
  });
}

export async function releaseOnMikesWords(
  db: PrismaClient,
  auth: AuthPayload,
  taskId: string,
  body: unknown,
  now: Date = new Date(),
  opts: { record?: typeof recordWords; release?: typeof releaseCard } = {},
): Promise<ReleaseOnWordsResult> {
  if (!isFrontSessionCaller(auth)) throw new ApiError(FRONT_SESSION_ONLY, 403, 'front_session_only');
  const input = releaseOnWordsSchema.parse(body);
  if (new Date(input.said_at).getTime() > now.getTime() + FUTURE_SKEW_MS) throw new ApiError('said_at is more than five minutes in the future.', 400, 'said_at_future');
  const [card] = await loadCards(db, [taskId]);
  if (!card) throw new ApiError('That card is not in Triage.', 404, 'not_in_triage');
  const version = input.release_version ?? card.release_version;
  // Order matters: his words go on the card first, so no card is ever out of Triage without them (releaseCard writes through the one task
  // patch path, outside any transaction, so the two cannot share one). If the release is then refused or fails and the card is still in
  // Triage, the record is taken back out (it described a release that did not happen) and the error stands. A comment does not change release_version.
  const comment = await (opts.record ?? recordWords)(db, taskId, auth, input);
  let release: HomeActResponse;
  try {
    // Run as Mike, the same call his Release tap makes; it refuses an unsorted card, a quote project and a card changed since `version`.
    release = await (opts.release ?? releaseCard)(db, MIKE_USER_ID, taskId, version, now);
  } catch (error) {
    // releaseCard can fail after the card has already moved (a later write in the same release). The record is taken back only when the card
    // is provably still in Triage; if it moved, or its status cannot be read, the record stays.
    const still = await db.task.findUnique({ where: { id: taskId }, select: { status: true } }).catch(() => null);
    if (still?.status === 'triage') {
      await db.comment.delete({ where: { id: comment.id } }).catch((e) => console.error('[front-session] could not take back the record of a release that failed', { taskId, comment_id: comment.id, e }));
    }
    throw error;
  }
  // The change line on the card ("Released by the front session on Mike's words"). The comment is the record; a failed line is logged, not fatal.
  try {
    const actor = await actorOf(auth, db);
    await recordTriageChange(db, taskId, 'release', `Released by ${actor.by} on Mike's words`, actor, `"${input.mike_words}" (${input.said_where})`);
  } catch (e) {
    console.error('[front-session] release change line not written', { taskId, e });
  }
  return { release, comment_id: comment.id };
}
