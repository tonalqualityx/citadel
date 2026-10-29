import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createOrGetSession } from '../sessions';
import { claimCommand, completeCommand, createCommand, inbox } from '../commands';
import { appendDesignerEvent } from '../events';
import { SCRATCH, seedDesign, seedTask, teardownDesign, type DesignFixture } from './fixtures';

describe.skipIf(!SCRATCH)('commands (real database)', () => {
  let f: DesignFixture;
  let sessionId: string;
  const other = new PrismaClient();
  beforeAll(async () => {
    f = await seedDesign(`cm${Date.now()}`);
    sessionId = (await createOrGetSession(f.designer, await seedTask(f))).session.id;
  });
  afterAll(async () => {
    await teardownDesign(f);
    await other.$disconnect();
    await prisma.$disconnect();
  });

  it('claim race: exactly one winner, the rest get 409 command_taken', async () => {
    for (let round = 0; round < 10; round++) {
      const { command } = await createCommand({ sessionId, verb: 'restore', payload: { to_sha: `s${round}` }, createdById: f.designer.userId });
      const rs = await Promise.allSettled([claimCommand(command.id), claimCommand(command.id, other), claimCommand(command.id), claimCommand(command.id, other)]);
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of rs) if (r.status === 'rejected') expect(r.reason).toMatchObject({ statusCode: 409, code: 'command_taken' });
      await completeCommand(command.id, { status: 'done' });
    }
  });

  it('complete needs a claim, caps the result at 8 KB, and a second complete is 409', async () => {
    const { command } = await createCommand({ sessionId, verb: 'restore', payload: { to_sha: 'a' }, createdById: f.designer.userId });
    await expect(completeCommand(command.id, { status: 'done' })).rejects.toMatchObject({ statusCode: 409 });
    await claimCommand(command.id);
    await expect(completeCommand(command.id, { status: 'done', result: { x: 'y'.repeat(9000) } })).rejects.toMatchObject({ statusCode: 413 });
    const done = await completeCommand(command.id, { status: 'done', result: { ok: true } });
    expect(done.status).toBe('done');
    expect(done.completed_at).not.toBeNull();
    await expect(completeCommand(command.id, { status: 'done' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(claimCommand('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('stop is idempotent while one is pending', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => createCommand({ sessionId, verb: 'stop', createdById: f.designer.userId })));
    expect(new Set(rs.map((r) => r.command.id)).size).toBe(1);
    expect(rs.filter((r) => r.created)).toHaveLength(1);
    await claimCommand(rs[0].command.id);
    expect((await createCommand({ sessionId, verb: 'stop', createdById: f.designer.userId })).created).toBe(true);
  });

  it('inbox returns pending commands oldest first, then messages', async () => {
    const s2 = (await createOrGetSession(f.designer, await seedTask(f))).session.id;
    const a = await createCommand({ sessionId: s2, verb: 'refresh_client_files', createdById: f.designer.userId });
    const b = await createCommand({ sessionId: s2, verb: 'close', createdById: f.admin.userId });
    const box = await inbox({ max: 200 });
    const mine = box.commands.filter((c) => c.session_id === s2);
    expect(mine.map((c) => c.id)).toEqual([a.command.id, b.command.id]);
    expect(mine[1].created_by).toEqual({ id: f.admin.userId, role: 'admin' });
    const times = box.commands.map((c) => c.created_at.getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
    await appendDesignerEvent({ sessionId: s2, authorId: f.designer.userId, kind: 'text', payload: { text: 'x' }, clientRef: 'i1' });
    expect(Array.isArray((await inbox()).messages)).toBe(true);
  });
});
