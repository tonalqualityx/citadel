/**
 * Post-signature kickoff automation (ops-review finding B6).
 *
 * Today, when a client signs a contract or MSA through the portal, nothing downstream
 * happens automatically — a human has to notice the signature and start the engagement.
 * This is the one unautomated hop in the client journey. Phase 1 (conservative): auto-create
 * a cockpit-owned kickoff TASK and fire the existing signature notification — it does NOT
 * auto-create a project. A human (or the cockpit) still decides when the engagement actually
 * starts; the worker must never self-start it (hence the `cockpit-owned` tag).
 *
 * Hard requirement: neither of the two exported functions here may ever throw. The contract/
 * MSA sign routes call these AFTER the signature itself is already recorded — a failure here
 * (missing user, DB hiccup, whatever) must never turn a successful signature into a 500. Both
 * functions catch everything internally and log; callers can still wrap the call site in their
 * own try/catch as a second safety net (the sign routes do — belt and suspenders).
 */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { serializeRichText } from '@/lib/api/blocknote';
import { addBusinessDays } from '@/lib/utils/time';
import { notifyContractSigned, notifyMsaSigned } from '@/lib/services/notifications';

// Same default-operator-by-email pattern as POST /api/session-tasks and the arc board's
// "+ Quest" quick-add — resolved at request time, never hardcoded to a user id.
const KICKOFF_ASSIGNEE_EMAIL = 'bast@becomeindelible.com';
const FALLBACK_ASSIGNEE_EMAIL = 'mike@becomeindelible.com';
const NOTIFY_RECIPIENT_EMAIL = 'mike@becomeindelible.com';

const KICKOFF_DUE_BUSINESS_DAYS = 2;
const KICKOFF_TAG = 'cockpit-owned';
const KICKOFF_PRIORITY = 2;

export type KickoffSignatureType = 'contract' | 'msa';

export interface RunSignatureKickoffParams {
  signatureType: KickoffSignatureType;
  // Null for a lead-stage accord that hasn't been converted to a Client yet.
  clientId: string | null;
  clientName: string;
  // Present for contract signatures; absent for MSA signatures (ClientMsaSignature has no
  // accord — it's a per-client agreement, not tied to a specific deal).
  accordId?: string | null;
  accordName?: string | null;
  signerName: string;
  signerEmail: string;
}

export interface CreateKickoffTaskResult {
  created: boolean;
  deduped?: boolean;
  taskId?: string;
  error?: string;
}

function kickoffTitle(clientName: string, signatureType: KickoffSignatureType): string {
  const suffix = signatureType === 'msa' ? 'MSA signed' : 'contract signed';
  return `Kickoff: ${clientName} — ${suffix}`;
}

function kickoffDescription(params: RunSignatureKickoffParams): string {
  const whatWasSigned =
    params.signatureType === 'msa'
      ? `**What was signed:** Master Service Agreement — signed by ${params.signerName} (${params.signerEmail}).`
      : `**What was signed:** Contract — signed by ${params.signerName} (${params.signerEmail}).`;

  const reference =
    params.accordId != null
      ? `**Accord:** [${params.accordName ?? params.clientName}](/deals/${params.accordId})`
      : params.clientId
        ? `**Client:** [${params.clientName}](/clients/${params.clientId})`
        : `**Client:** ${params.clientName}`;

  return [
    whatWasSigned,
    reference,
    '',
    '**Next steps:**',
    '- Create a project from the recipe via the project wizard (/projects/new)',
    '- Schedule the kickoff meeting',
    '- Begin Wright B0 (site discovery)',
  ].join('\n');
}

/**
 * Create the cockpit-owned kickoff task for a signature event. Idempotent — the same
 * check-before-create dedupe pattern POST /api/session-tasks uses for session-born quests:
 * an existing, non-deleted task with the same title + client_id + accord_id is never
 * duplicated, it's just returned as `deduped`.
 *
 * Never throws — DB errors and a missing assignee are caught/logged and reported back in
 * the result instead, so a signing event can never fail because kickoff-task creation did.
 */
export async function createKickoffTask(
  params: RunSignatureKickoffParams
): Promise<CreateKickoffTaskResult> {
  try {
    const title = kickoffTitle(params.clientName, params.signatureType);

    const existing = await prisma.task.findFirst({
      where: {
        is_deleted: false,
        title,
        client_id: params.clientId,
        accord_id: params.accordId ?? null,
      },
      select: { id: true },
    });
    if (existing) {
      return { created: false, deduped: true, taskId: existing.id };
    }

    let assignee = await prisma.user.findUnique({
      where: { email: KICKOFF_ASSIGNEE_EMAIL, is_active: true },
    });
    if (!assignee) {
      console.warn(
        `[kickoff-task] Assignee ${KICKOFF_ASSIGNEE_EMAIL} not found or inactive — ` +
          `falling back to ${FALLBACK_ASSIGNEE_EMAIL}`
      );
      assignee = await prisma.user.findUnique({
        where: { email: FALLBACK_ASSIGNEE_EMAIL, is_active: true },
      });
    }
    if (!assignee) {
      console.error(
        '[kickoff-task] Neither the primary assignee nor the fallback user could be resolved — kickoff task not created'
      );
      return { created: false, error: 'no_assignee_available' };
    }

    const task = await prisma.task.create({
      data: {
        id: randomUUID(),
        title,
        description: serializeRichText(kickoffDescription(params)),
        status: 'not_started',
        priority: KICKOFF_PRIORITY,
        client_id: params.clientId,
        accord_id: params.accordId ?? null,
        assignee_id: assignee.id,
        due_date: addBusinessDays(new Date(), KICKOFF_DUE_BUSINESS_DAYS),
        source: 'internal',
        tags: [KICKOFF_TAG],
        needs_review: false,
      },
      select: { id: true },
    });

    return { created: true, taskId: task.id };
  } catch (error) {
    console.error('[kickoff-task] Failed to create kickoff task:', error);
    return { created: false, error: error instanceof Error ? error.message : 'unknown_error' };
  }
}

/**
 * Full post-signature automation: create the kickoff task, then fire the existing
 * signature notification (extended, not replaced — see lib/services/notifications.ts) so
 * the kickoff task is mentioned in whatever already tells Mike a signature happened.
 *
 * Never throws. Call this AFTER the signature write has already succeeded.
 */
export async function runSignatureKickoffAutomation(
  params: RunSignatureKickoffParams
): Promise<void> {
  try {
    const kickoffResult = await createKickoffTask(params);
    const kickoffTaskReady = kickoffResult.created || kickoffResult.deduped === true;

    const recipient = await prisma.user.findUnique({
      where: { email: NOTIFY_RECIPIENT_EMAIL, is_active: true },
    });
    if (!recipient) {
      console.warn(
        `[kickoff-task] Notification recipient ${NOTIFY_RECIPIENT_EMAIL} not found — skipping signature notification`
      );
      return;
    }

    if (params.signatureType === 'contract' && params.accordId) {
      await notifyContractSigned(
        params.accordId,
        params.accordName ?? params.clientName,
        recipient.id,
        kickoffTaskReady
      );
    } else if (params.clientId) {
      // MSA signatures are always tied to a Client (ClientMsaSignature.client_id is
      // required) — the branch above only handles the contract case, so clientId is
      // guaranteed here for every real MSA call site.
      await notifyMsaSigned(params.clientId, params.clientName, recipient.id, kickoffTaskReady);
    }
  } catch (error) {
    console.error('[kickoff-task] Signature automation failed:', error);
  }
}
