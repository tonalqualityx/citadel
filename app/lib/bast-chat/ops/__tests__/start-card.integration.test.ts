// @vitest-environment node
/**
 * start_project with card_task_id against a real scratch Postgres: the Triage card becomes the setup task of the new queue project
 * (no kickoff task), and Undo unlinks it and restores what the card held.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { BAST_USER_ID } from '../../gate-mirror';
import { undoAction } from '../../actions';
import { getRunnableOp } from '..';
import { applyChatOp } from '../apply';

const URL = process.env.DATABASE_URL ?? '';
const RUN = /scratch/i.test(URL) && /localhost|127\.0\.0\.1/.test(URL);

describe.skipIf(!RUN)('start_project card_task_id (real database)', () => {
  const tag = `stc-${Date.now()}`;
  const ownerId = randomUUID();
  let conversationId = '';
  let clientId = '';
  const taskIds: string[] = [];

  const apply = (rawInput: object) =>
    applyChatOp({ ownerId, conversationId, op: getRunnableOp('start_project')!, rawInput, dailyWriteCap: 1_000_000, now: new Date(), db: prisma });
  const mkCard = async (data: Record<string, unknown> = {}) => {
    const t = await prisma.task.create({ data: { title: `${tag} card`, status: 'triage', ...data } as never });
    taskIds.push(t.id);
    return t.id;
  };

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner', role: 'admin' } });
    await prisma.user.upsert({ where: { id: BAST_USER_ID }, update: {}, create: { id: BAST_USER_ID, email: `bast-${tag}@example.test`, password_hash: 'x', name: 'Bast', role: 'pm' } });
    await prisma.bastChatSettings.upsert({ where: { id: 1 }, update: { owner_user_id: ownerId, enabled: true, daily_write_cap: 1_000_000 }, create: { id: 1, owner_user_id: ownerId, enabled: true, daily_write_cap: 1_000_000 } });
    conversationId = (await prisma.bastChatConversation.create({ data: { owner_id: ownerId, status: 'running' } })).id;
    clientId = (await prisma.client.create({ data: { name: `Card Co ${tag}` } })).id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('the card becomes the setup task: linked to the new queue project, kind project_setup, no kickoff task made', async () => {
    const card = await mkCard({ triage_kind: 'task' });
    const before = await prisma.task.count({ where: { tags: { has: 'kickoff' }, client_id: clientId } });
    const r = await apply({ client_id: clientId, what: 'Build the site', message: 'build it', card_task_id: card });
    if (r.kind !== 'applied') throw new Error('expected applied');
    const res = r.run.result as { project_id: string; task_id: string };
    expect(res.task_id).toBe(card);
    const t = await prisma.task.findUniqueOrThrow({ where: { id: card } });
    expect(t).toMatchObject({ status: 'triage', project_id: res.project_id, triage_kind: 'project_setup', client_id: clientId });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: res.project_id } })).status).toBe('queue');
    expect(await prisma.task.count({ where: { tags: { has: 'kickoff' }, client_id: clientId } })).toBe(before);
  });

  it('Undo cancels the project and puts the card back as it was (no project, old kind, old client)', async () => {
    const card = await mkCard({ triage_kind: 'task' });
    const r = await apply({ client_id: clientId, what: 'Undo with card', message: 'm', card_task_id: card });
    if (r.kind !== 'applied') throw new Error('expected applied');
    const res = r.run.result as { project_id: string };
    const v = await undoAction(r.row.id, ownerId, new Date(), prisma);
    expect(v.status).toBe('undone');
    expect((await prisma.project.findUniqueOrThrow({ where: { id: res.project_id } })).status).toBe('cancelled');
    const t = await prisma.task.findUniqueOrThrow({ where: { id: card } });
    expect(t).toMatchObject({ status: 'triage', project_id: null, triage_kind: 'task', client_id: null });
  });

  it('a card that is gone, not in Triage, or already has a project is refused and nothing is written', async () => {
    const projects = await prisma.project.count({ where: { client_id: clientId } });
    await expect(apply({ client_id: clientId, what: 'x', message: 'x', card_task_id: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
    const active = await mkCard({ status: 'not_started' });
    await expect(apply({ client_id: clientId, what: 'x', message: 'x', card_task_id: active })).rejects.toMatchObject({ statusCode: 404 });
    const p = await prisma.project.create({ data: { name: `${tag} existing`, client_id: clientId } });
    const linked = await mkCard({ project_id: p.id });
    await expect(apply({ client_id: clientId, what: 'x', message: 'x', card_task_id: linked })).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.project.count({ where: { client_id: clientId } })).toBe(projects + 1); // only the one this test made
  });
});
