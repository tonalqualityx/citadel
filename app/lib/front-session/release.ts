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
 *   2. records his words on the card: an internal comment quoting him with where and when, written first as a request (so a card never
 *      leaves Triage without it), reworded as the release once the move is confirmed, taken back out if the card never moved, and reworded
 *      as a failed request if the call failed with the card out of Triage; after the release a change line names the front session.
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
import { FRONT_SESSION_LANE, isFrontSessionCaller } from './identity';

export { FRONT_SESSION_LANE, isFrontSessionCaller };
export const FRONT_SESSION_ONLY = "Only the front session's key releases a card this way.";
const FUTURE_SKEW_MS = 5 * 60 * 1000;

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

const quoteBlock = (input: Pick<ReleaseOnWords, 'mike_words' | 'said_where' | 'said_at'>) =>
  `Mike, ${input.said_where}, ${new Date(input.said_at).toISOString()}:\n"${input.mike_words}"`;

/** The comment as first written, before the card moves: a request on his words, never a claim that anything was released. */
export function requestedWordsComment(input: Pick<ReleaseOnWords, 'mike_words' | 'said_where' | 'said_at'>): string {
  return `The front session asked to release this card from Triage on Mike's words.\n\n${quoteBlock(input)}`;
}

/** The comment once the release went through. */
export function wordsComment(input: Pick<ReleaseOnWords, 'mike_words' | 'said_where' | 'said_at'>): string {
  return `Released from Triage by the front session on Mike's words.\n\n${quoteBlock(input)}`;
}

/** The comment when the release returned an error and the card is out of Triage anyway: who moved it is not known, so it says so. */
export function failedWordsComment(input: Pick<ReleaseOnWords, 'mike_words' | 'said_where' | 'said_at'>, code: string): string {
  return `The front session asked to release this card from Triage on Mike's words, and that request returned an error (${code}). The card is out of Triage: this request or another release moved it.\n\n${quoteBlock(input)}`;
}

export interface ReleaseOnWordsResult {
  release: HomeActResponse;
  comment_id: string;
}

/** The record of Mike's words on the card: an internal comment quoting him with where and when, worded as a request. Written BEFORE the card moves. */
export async function recordWords(db: PrismaClient, taskId: string, auth: AuthPayload, input: ReleaseOnWords): Promise<{ id: string }> {
  return db.comment.create({
    data: { task_id: taskId, user_id: auth.userId, content: requestedWordsComment(input), is_internal: true, client_visible: false, actor_lane: FRONT_SESSION_LANE },
    select: { id: true },
  });
}

export async function releaseOnMikesWords(
  db: PrismaClient,
  auth: AuthPayload,
  taskId: string,
  body: unknown,
  now: Date = new Date(),
  opts: { record?: typeof recordWords; release?: typeof releaseCard; finish?: (commentId: string, content: string | null) => Promise<unknown> } = {},
): Promise<ReleaseOnWordsResult> {
  if (!isFrontSessionCaller(auth)) throw new ApiError(FRONT_SESSION_ONLY, 403, 'front_session_only');
  const input = releaseOnWordsSchema.parse(body);
  if (new Date(input.said_at).getTime() > now.getTime() + FUTURE_SKEW_MS) throw new ApiError('said_at is more than five minutes in the future.', 400, 'said_at_future');
  const [card] = await loadCards(db, [taskId]);
  if (!card) throw new ApiError('That card is not in Triage.', 404, 'not_in_triage');
  const version = input.release_version ?? card.release_version;
  // Order matters: his words go on the card first, worded as a request, so no card is ever out of Triage without them (releaseCard writes
  // through the one task patch path, outside any transaction, so the two cannot share one). Only after the move is confirmed does the
  // comment say "Released"; if that rewording fails, the card still carries an accurate request. A comment does not change release_version.
  // The final write: new content for the comment, or null to take it back out.
  const finish =
    opts.finish ??
    ((id: string, content: string | null) => (content === null ? db.comment.delete({ where: { id } }) : db.comment.update({ where: { id }, data: { content } })));
  const comment = await (opts.record ?? recordWords)(db, taskId, auth, input);
  let release: HomeActResponse;
  try {
    // Run as Mike, the same call his Release tap makes; it refuses an unsorted card, a quote project and a card changed since `version`.
    release = await (opts.release ?? releaseCard)(db, MIKE_USER_ID, taskId, version, now);
  } catch (error) {
    // Still in Triage: nothing moved, so the request is taken back out. Out of Triage (this release failed after its move, or a concurrent
    // release won): his words stay, reworded to say the request returned an error and the card moved, by whom unknown.
    // If this write fails, the comment keeps its request wording, which is still true.
    const still = await db.task.findUnique({ where: { id: taskId }, select: { status: true } }).catch(() => null);
    const code = error instanceof ApiError && error.code ? error.code : 'error';
    // Status unreadable: leave the request wording, which is true whatever happened.
    if (still) {
      await finish(comment.id, still.status === 'triage' ? null : failedWordsComment(input, code)).catch((e) =>
        console.error('[front-session] could not correct the record of a release that failed', { taskId, comment_id: comment.id, e }),
      );
    }
    throw error;
  }
  // The move is confirmed: the request becomes the release record. A failed rewording leaves the accurate request wording, logged, not fatal.
  await finish(comment.id, wordsComment(input)).catch((e) => console.error('[front-session] release went through but its comment still reads as a request', { taskId, comment_id: comment.id, e }));
  // The change line on the card ("Released by the front session on Mike's words"); logged, not fatal.
  try {
    const actor = await actorOf(auth, db);
    await recordTriageChange(db, taskId, 'release', `Released by ${actor.by} on Mike's words`, actor, `"${input.mike_words}" (${input.said_where})`);
  } catch (e) {
    console.error('[front-session] release change line not written', { taskId, e });
  }
  return { release, comment_id: comment.id };
}
