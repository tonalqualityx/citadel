/**
 * Designer Portal v2: one client brief email per signed art direction version, recorded in Citadel (W6.1 F7).
 *
 * The runner calls `claim` BEFORE it sends, then `sent` or `held`. Every move is ONE conditional update on the
 * `DesignArtDirection` row whose `client_email_job_id` is the job, so two runners (two boxes, a cleared state folder, a
 * manual run) can never both send: exactly one claim moves the row to `sending`, every other claim is 409. This is the
 * only code that moves a row into `sending`. The runner's local marker file stays as a second lock.
 *
 * A held email was never sent, so it can be claimed again (a later run once the sender is installed, or Mike's release
 * of a held draft). Only a row that was never claimed can be held (W6.4 M1): a run that has not claimed may not touch a
 * claimed row, so once a row has been `sending` it never returns to a claimable state and at most one claim ever
 * succeeds per row. A run that claimed and then could not attempt the send leaves the row at `sending` for good: that
 * is intended (fail closed; a send that may have gone out is never repeated), and a person sorts it out.
 *
 * - claim:  queued | held -> sending               200 {claimed: true}  | 409 email_already_claimed
 * - sent:   sending -> sent, client_email_sent_at   200 {ok: true}       | 409 email_not_claimed
 * - held:   queued -> held + reason                 200 {ok: true}       | 409 email_not_holdable (sending, sent, held)
 * A job id that is no row's `client_email_job_id` is 404. Every 409 carries the row's current status and changes nothing.
 */
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';

export const CLIENT_EMAIL_ACTIONS = ['claim', 'sent', 'held'] as const;
export type ClientEmailAction = (typeof CLIENT_EMAIL_ACTIONS)[number];
export const MAX_HELD_REASON_CHARS = 2000;

export type ClientEmailOutcome =
  | { ok: true; body: { claimed: true } | { ok: true } }
  | { ok: false; code: 'email_already_claimed' | 'email_not_claimed' | 'email_not_holdable'; status: string | null };

type Db = Pick<typeof prisma, 'designArtDirection'>;

export async function moveClientEmail(jobId: string, action: ClientEmailAction, reason: string | undefined, db: Db = prisma): Promise<ClientEmailOutcome> {
  const row = await db.designArtDirection.findUnique({ where: { client_email_job_id: jobId }, select: { id: true } });
  if (!row) throw new ApiError('Job not found', 404, 'not_found');
  let changed: number;
  let refused: 'email_already_claimed' | 'email_not_claimed' | 'email_not_holdable';
  if (action === 'claim') {
    changed = (await db.designArtDirection.updateMany({ where: { id: row.id, client_email_status: { in: ['queued', 'held'] } }, data: { client_email_status: 'sending' } })).count;
    refused = 'email_already_claimed';
  } else if (action === 'sent') {
    changed = (await db.designArtDirection.updateMany({ where: { id: row.id, client_email_status: 'sending' }, data: { client_email_status: 'sent', client_email_sent_at: new Date() } })).count;
    refused = 'email_not_claimed';
  } else {
    const why = reason?.trim() ? reason.trim().slice(0, MAX_HELD_REASON_CHARS) : null;
    changed = (await db.designArtDirection.updateMany({ where: { id: row.id, client_email_status: 'queued' }, data: { client_email_status: 'held', client_email_held_reason: why } })).count;
    refused = 'email_not_holdable';
  }
  if (changed === 1) return { ok: true, body: action === 'claim' ? { claimed: true } : { ok: true } };
  const now = await db.designArtDirection.findUnique({ where: { id: row.id }, select: { client_email_status: true } });
  return { ok: false, code: refused, status: now?.client_email_status ?? null };
}
