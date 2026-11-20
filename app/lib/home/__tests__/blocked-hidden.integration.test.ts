// @vitest-environment node
/**
 * The home screen lists the owner's task only once every task it waits on is closed (Mike, 2026-11-20: "It's telling me
 * that I've got a draft email to send. The links show no draft."). Against a real Postgres.
 *
 * Skips unless DATABASE_URL names the scratch Postgres on localhost:55433. It removes only the rows it made.
 * Run: DATABASE_URL=postgresql://citadel:citadel@localhost:55433/home_s3 npx vitest run lib/home/__tests__/blocked-hidden.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { loadHomeInputs } from '../load';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');
const TZ = 'America/New_York';
const NOW = new Date('2026-11-20T18:00:00Z');

describe.skipIf(!SCRATCH)('home: a task that waits on an open task is not listed (real database)', () => {
  const tag = `blk-${Date.now()}`;
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner Blk', role: 'admin' },
        { id: otherId, email: `other-${tag}@example.test`, password_hash: 'x', name: 'Other Blk', role: 'tech' },
      ],
    });
    await prisma.userPreference.create({ data: { user_id: ownerId, home_view: 'home', timezone: TZ } });
    const mk = async (title: string, assignee: string, status: 'not_started' | 'blocked' | 'done' | 'abandoned', extra: Record<string, unknown> = {}) => {
      const t = await prisma.task.create({ data: { title, assignee_id: assignee, created_by_id: otherId, status, needs_review: false, tags: [tag], ...extra } });
      ids[title] = t.id;
      return t.id;
    };
    const draft = await mk('Draft the email', otherId, 'not_started');
    const doneDraft = await mk('Draft already written', otherId, 'done');
    const deletedDraft = await mk('Deleted draft task', otherId, 'not_started', { is_deleted: true });
    await mk('Send waits on open draft', ownerId, 'blocked', { blocked_by: { connect: [{ id: draft }] } });
    await mk('Send after done draft', ownerId, 'not_started', { blocked_by: { connect: [{ id: doneDraft }] } });
    await mk('Send after deleted draft', ownerId, 'not_started', { blocked_by: { connect: [{ id: deletedDraft }] } });
    await mk('Marked blocked, nothing open behind it', ownerId, 'blocked');
    await mk('Plain task', ownerId, 'not_started');
  });

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.userPreference.deleteMany({ where: { user_id: ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.$disconnect();
  });

  const titles = async () => (await loadHomeInputs(prisma, ownerId, NOW, { timezone: TZ })).tasks.map((t) => t.title);

  it('hides the task while its blocker is open, and lists the rest', async () => {
    const t = await titles();
    expect(t).not.toContain('Send waits on open draft');
    expect(t).toEqual(expect.arrayContaining(['Send after done draft', 'Send after deleted draft', 'Marked blocked, nothing open behind it', 'Plain task']));
  });

  it('lists it as soon as the blocker closes', async () => {
    await prisma.task.update({ where: { id: ids['Draft the email'] }, data: { status: 'done' } });
    expect(await titles()).toContain('Send waits on open draft');
  });
});
