/**
 * DELIBERATELY NON-ATOMIC claim (read, then write). Test fixture only, never imported by app code.
 * It exists to prove the race test can fail: CLAIMS_IMPL=naive runs claims.race.test.ts against this.
 * This is the shape of the Troubador claim, which Fleet item 3 replaces with a single UPDATE.
 */
import type { PrismaClient } from '@prisma/client';
import { clampTtl, type ClaimResult } from '../claims';

export async function claimTaskNaive(
  input: { taskId: string; holder: string; ttlSeconds?: number | null },
  db: PrismaClient,
): Promise<ClaimResult> {
  const ttl = clampTtl(input.ttlSeconds);
  const t = await db.task.findUnique({ where: { id: input.taskId }, select: { claim_holder: true, claim_token: true, lease_until: true } });
  if (!t) return { ok: false, reason: 'not_found' };
  const now = new Date();
  if (t.lease_until && t.lease_until > now && t.claim_holder !== input.holder) {
    return { ok: false, reason: 'taken', holder: t.claim_holder, lease_until: t.lease_until };
  }
  // The gap between the read above and the write below is the race.
  const token = crypto.randomUUID();
  const lease = new Date(now.getTime() + ttl * 1000);
  await db.task.update({ where: { id: input.taskId }, data: { claim_holder: input.holder, claim_token: token, claimed_at: now, lease_until: lease } });
  return { ok: true, claim: { task_id: input.taskId, holder: input.holder, token, claimed_at: now, lease_until: lease } };
}
