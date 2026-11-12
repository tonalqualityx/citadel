// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { unwindTriage, WAS_TRIAGE_TAG } from './triage-unwind';

describe.skipIf(!SCRATCH)('triage unwind script (real database)', () => {
  const ids: string[] = [];
  afterAll(async () => {
    await prisma.task.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });
  it('dry run writes nothing; --apply moves triage tasks to not_started with the was-triage tag', async () => {
    const t = await prisma.task.create({ data: { title: `unwind ${Date.now()}`, status: 'triage', tags: ['x'] } });
    const other = await prisma.task.create({ data: { title: `unwind other ${Date.now()}`, status: 'in_progress' } });
    ids.push(t.id, other.id);
    const dry = await unwindTriage(false);
    expect(dry.found).toBeGreaterThanOrEqual(1);
    expect(dry.moved).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('triage');
    await unwindTriage(true);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('not_started');
    expect(after.tags).toEqual(['x', WAS_TRIAGE_TAG]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('in_progress');
    expect(await prisma.task.count({ where: { status: 'triage' } })).toBe(0);
  });
});
