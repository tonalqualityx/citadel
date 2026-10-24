/**
 * The send step of charter.price_review. Queues the fixed price note through EmailOutbox, one
 * row per portal owner of the charter's client, and only when BOTH switches are on:
 * WAIT_SENDERS (the sweeper's own, passed in) and PRICE_REVIEW_SEND (lib/config/feature-flags.ts).
 * The sweeper already holds the wait as blocked_by_switch when either is off; this function checks
 * again so it can never queue by itself with a switch off.
 *
 * The amount and date come from Mike's approval record on the approval step and nowhere else
 * (lib/price-review/terms.ts). No record, or one Mike did not write, means nothing is rendered
 * and nothing is queued. Citadel never sends mail: the Bast machine drains the outbox.
 */
import type { PrismaClient } from '@prisma/client';
import { PRICE_REVIEW_SEND } from '@/lib/config/feature-flags';
import { BAST_ACCOUNT } from '@/lib/portal/chat/mailer';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import type { WaitRow } from '@/lib/waits/sweeper';
import { PRICE_REVIEW_MAIL_KIND } from './outbox-guard';
import { PriceReviewRenderError, renderPriceReviewMail } from './template';
import { AGENCY_SUB_CLIENT_REASON, PRICE_REVIEW_APPROVAL_STEP, PRICE_REVIEW_TEMPLATE_KEY, readApprovedTerms } from './terms';


type Db = Pick<PrismaClient, 'wait' | 'charter' | 'clientContact' | 'emailOutbox'>;

export interface SendDeps {
  /** The sweeper's switch reader. */
  switchIsOn: (key: string) => Promise<boolean>;
  /** Today. Defaults to the real clock; tests pass a fixed one. */
  now?: () => Date;
}

/** Mike's approval record for this send wait: the approval step that opened it. Null when there is none. */
export async function loadApprovalFor(db: Pick<PrismaClient, 'wait'>, send: WaitRow): Promise<unknown | null> {
  const key = send.idempotency_key ?? '';
  if (!key.endsWith(':next')) return null;
  const approval = await db.wait.findUnique({ where: { id: key.slice(0, -':next'.length) } });
  if (!approval) return null;
  if (approval.template_key !== PRICE_REVIEW_TEMPLATE_KEY || approval.step !== PRICE_REVIEW_APPROVAL_STEP) return null;
  if (approval.state !== 'done' || approval.resolution !== 'approved') return null;
  // Only Mike's own approval carries a number into the mail.
  if (approval.resolved_by_id !== MIKE_USER_ID) return null;
  if (approval.charter_id !== send.charter_id) return null;
  const terms = readApprovedTerms(approval.action_payload);
  const raw = (approval.action_payload as Record<string, unknown> | null)?.approved_terms as { approved_by?: unknown; approved_via?: unknown } | undefined;
  // Written from Mike's signed-in session only (a token or API key never counts).
  if (!terms || raw?.approved_by !== MIKE_USER_ID || raw?.approved_via !== 'session') return null;
  return terms;
}

const firstNameOf = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] || null;

/** Queues the note. Returns the outbox ids. Throws when it must not send. */
export async function queuePriceReviewSend(db: Db, wait: WaitRow, deps: SendDeps): Promise<{ queued: string[] }> {
  if (!(await deps.switchIsOn('WAIT_SENDERS')) || !PRICE_REVIEW_SEND()) {
    throw new Error('A send switch is off (WAIT_SENDERS and PRICE_REVIEW_SEND must both be on). Nothing was queued.');
  }
  if (!wait.charter_id) throw new Error('The send step has no charter.');

  const approval = await loadApprovalFor(db, wait);
  if (!approval) {
    throw new PriceReviewRenderError('No approved amount and start date from Mike on the approval step. Nothing was queued.');
  }

  const charter = await db.charter.findUnique({
    where: { id: wait.charter_id },
    select: { id: true, client_id: true, client_label: true, is_deleted: true, status: true, client: { select: { parent_agency_id: true } } },
  });
  if (!charter || charter.is_deleted || charter.status !== 'active') throw new Error('The charter is no longer active. Nothing was queued.');
  // An agency sub-client is billed through the agency. The end client never gets this note.
  if (charter.client.parent_agency_id) throw new Error(AGENCY_SUB_CLIENT_REASON + ' Nothing was queued.');
  // The plan name the client sees, or null (the note then says "your marketing plan").
  const planLabel = charter.client_label?.trim() || null;
  const now = (deps.now ?? (() => new Date()))();

  const contacts = await db.clientContact.findMany({
    where: { client_id: charter.client_id, is_deleted: false, portal_role: 'owner', email: { not: '' } },
    select: { id: true, name: true, email: true },
    orderBy: { created_at: 'asc' },
  });
  if (contacts.length === 0) throw new Error('The client has no portal owner with an email address. Nothing was queued.');

  // Render every message first: a failure on any of them queues none.
  const mails = contacts.map((c) => ({ c, mail: renderPriceReviewMail({ firstName: firstNameOf(c.name), planLabel, approval, now }) }));

  const queued: string[] = [];
  for (const { c, mail } of mails) {
    const dedupe_key = `price-review:${wait.id}:${c.id}`;
    const existing = await db.emailOutbox.findUnique({ where: { dedupe_key }, select: { id: true } });
    if (existing) {
      queued.push(existing.id);
      continue;
    }
    const row = await db.emailOutbox.create({
      data: {
        to: c.email.trim(),
        subject: mail.subject,
        text: mail.text,
        from_account: BAST_ACCOUNT,
        kind: PRICE_REVIEW_MAIL_KIND,
        allow_external: true,
        dedupe_key,
      },
      select: { id: true },
    });
    queued.push(row.id);
  }
  return { queued };
}

/** The sweeper's send handler for charter.price_review. */
export function makePriceReviewSendHandler(db: Db, deps: SendDeps) {
  return async (wait: WaitRow): Promise<void> => {
    await queuePriceReviewSend(db, wait, deps);
  };
}
