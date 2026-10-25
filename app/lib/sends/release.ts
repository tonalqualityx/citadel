/**
 * Give back the notice claim a dead outbox row was holding (Fleet item 4). A row queued by the producer that
 * took the claim carries `snapshot.claimed` and `snapshot.holder`. When that row is superseded or fails for
 * good, nobody has told the client, so the claim goes back, unless another row of the same kind for the task
 * was actually sent (then the client was told and the claim stands).
 */
import { prisma } from '@/lib/db/prisma';
import { parseGovern } from './govern';
import { releaseNotice } from './claims';

export const MAX_SEND_ATTEMPTS = 5;

export async function releaseClaimForRow(row: { id: string; govern: unknown; task_id?: string | null }): Promise<boolean> {
  try {
    const g = parseGovern(row.govern);
    if (!g || !('snapshot' in g) || !g.snapshot || !('claimed' in g.snapshot) || !g.snapshot.claimed) return false;
    const holder = (g.snapshot as { holder?: string }).holder;
    if (!holder) return false;
    if (g.intent === 'golive') {
      const sent = await prisma.emailOutbox.count({ where: { task_id: g.task_id, kind: 'portal_golive', sent_at: { not: null }, id: { not: row.id } } });
      return sent > 0 ? false : releaseNotice(g.task_id, 'live', null, holder);
    }
    if (g.intent === 'approval_request' && g.snapshot.preview_url) {
      const sent = await prisma.emailOutbox.count({
        where: { sent_at: { not: null }, id: { not: row.id }, AND: [{ govern: { path: ['intent'], equals: 'approval_request' } }, { govern: { path: ['task_id'], equals: g.task_id } }, { govern: { path: ['snapshot', 'preview_url'], equals: g.snapshot.preview_url } }] },
      });
      return sent > 0 ? false : releaseNotice(g.task_id, 'preview', g.snapshot.preview_url, holder);
    }
    return false;
  } catch (error) {
    console.error('send recheck: could not release the claim of a dead row', error);
    return false;
  }
}
