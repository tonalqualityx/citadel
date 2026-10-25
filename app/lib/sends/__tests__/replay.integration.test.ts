// @vitest-environment node
/**
 * 7-day replay (Fleet item 4). Runs recheckSend over every email_outbox row sent in the last 7 days of the
 * connected database and prints each definitive drop (id, kind, reason) for a human to judge. Rows queued
 * before this change carry no govern block, so one is rebuilt from the row (kind, task_id, dedupe_key).
 * Report only: a drop here may be right (the state has moved on since the send), so it cannot assert zero.
 * Point DATABASE_URL at a scratch copy of production (the name must contain "scratch") to use it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { parseGovern, type Govern } from '../govern';
import { recheckSend } from '../recheck';

function rebuild(row: { kind: string; task_id: string | null; govern: unknown; dedupe_key: string | null }): Govern | null {
  const stored = parseGovern(row.govern);
  if (stored) return stored;
  if (row.kind === 'portal_golive' && row.task_id) return { intent: 'golive', task_id: row.task_id, snapshot: { claimed: true } };
  if (row.kind === 'portal_chat' && row.task_id) return { intent: 'chat', task_id: row.task_id };
  return null;
}

describe.skipIf(!SCRATCH)('7-day replay of sent outbox rows', () => {
  afterAll(async () => { await prisma.$disconnect(); });
  it('reports the definitive drops', async () => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const rows = await prisma.emailOutbox.findMany({ where: { sent_at: { gte: since } }, select: { id: true, kind: true, task_id: true, govern: true, dedupe_key: true, subject: true } });
    let checked = 0;
    const drops: string[] = [];
    for (const r of rows) {
      const g = rebuild(r);
      if (!g) continue;
      checked++;
      const res = await recheckSend(g);
      if (!res.ok && res.severity === 'definitive') drops.push(`${r.id} ${r.kind} ${res.reason}`);
    }
    console.log(JSON.stringify({ event: 'send_recheck_replay', sent_rows: rows.length, checked, definitive_drops: drops }));
    expect(checked).toBeLessThanOrEqual(rows.length);
  });
});
