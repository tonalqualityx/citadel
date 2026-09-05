import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Oracle Projects Tab Phase 3 — MEDIUM-2. GET /api/oracle/projects's `lastComments`
// query used to cast the COLUMN (`c.task_id::text IN (...)`), which defeats
// `comments_task_id_idx` (a btree index on `task_id`) — Postgres can't use a btree
// index to satisfy an equality test against a CASTED column, so every call fell back to
// a sequential scan. Fixed by casting the PARAMETER instead: `c.task_id = ANY($1::uuid[])`.
//
// This is a REAL integration test against the local dev Postgres (not a mock) — it runs
// exactly this route's query shape, seeds real rows, and proves both correctness
// (DISTINCT ON returns the newest comment per task) and the index fix (an EXPLAIN under
// `SET enable_seqscan=off` shows `comments_task_id_idx`, not a sequential scan). Skips
// when no DATABASE_URL is available (CI / a fresh checkout with no local DB) — that's a
// "can't check" state, not a failure.
function loadDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    const text = fs.readFileSync(envPath, 'utf-8');
    const match = text.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/m);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

const DATABASE_URL = loadDatabaseUrl();

interface LastCommentRow {
  id: string;
  task_id: string;
  content: string;
}

describe.skipIf(!DATABASE_URL)('last-comment DISTINCT ON query — MEDIUM-2 index fix (local DB)', () => {
  const client = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  const taskIds: string[] = [];
  let userId: string | null = null;

  beforeAll(async () => {
    const user = await client.user.findFirst({ select: { id: true } });
    if (!user) throw new Error('MEDIUM-2 integration test: no user found in the local DB to attach comments to');
    userId = user.id;

    for (let i = 0; i < 3; i++) {
      const task = await client.task.create({
        data: { title: `MEDIUM-2 drift test task ${i}` },
        select: { id: true },
      });
      taskIds.push(task.id);
      // 3 comments per task, oldest to newest — "-newest" is the one DISTINCT ON must win.
      for (let j = 0; j < 3; j++) {
        await client.comment.create({
          data: {
            task_id: task.id,
            user_id: userId,
            content: j === 2 ? `task-${i}-newest` : `task-${i}-comment-${j}`,
            created_at: new Date(Date.now() - (2 - j) * 60_000),
          },
        });
      }
    }
  });

  afterAll(async () => {
    await client.comment.deleteMany({ where: { task_id: { in: taskIds } } });
    await client.task.deleteMany({ where: { id: { in: taskIds } } });
    await client.$disconnect();
  });

  it('DISTINCT ON returns exactly one row per task — the newest by created_at', async () => {
    const rows = await client.$queryRaw<LastCommentRow[]>(Prisma.sql`
      SELECT DISTINCT ON (c.task_id) c.id, c.task_id, c.content
      FROM comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.task_id = ANY(${taskIds}::uuid[]) AND c.is_deleted = false
      ORDER BY c.task_id, c.created_at DESC
    `);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.content).toBe(`task-${taskIds.indexOf(row.task_id)}-newest`);
    }
  });

  it('the query plan uses comments_task_id_idx, not a sequential scan, under enable_seqscan=off', async () => {
    await client.$executeRawUnsafe('SET enable_seqscan = off');
    const plan = await client.$queryRaw<Array<Record<string, string>>>(Prisma.sql`
      EXPLAIN SELECT DISTINCT ON (c.task_id) c.id
      FROM comments c
      WHERE c.task_id = ANY(${taskIds}::uuid[]) AND c.is_deleted = false
      ORDER BY c.task_id, c.created_at DESC
    `);
    const planText = plan.map((row) => Object.values(row)[0]).join('\n');
    expect(planText).toContain('comments_task_id_idx');
  });
});

if (!DATABASE_URL) {
  describe('last-comment DISTINCT ON query — MEDIUM-2 index fix', () => {
    it.skip('SKIPPED: no DATABASE_URL available (CI / fresh checkout with no local DB) — cannot run this integration test here', () => {});
  });
}
