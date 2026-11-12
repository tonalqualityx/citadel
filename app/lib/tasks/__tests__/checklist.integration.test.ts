// @vitest-environment node
/**
 * The task checklist route through the REAL key-to-auth path against a real Postgres (only next/headers is replaced).
 * Production machine keys carry no lane, so both an unlaned Bast key and a lane key are tried. Skips unless DATABASE_URL names localhost:55433.
 *   DATABASE_URL=postgresql://citadel:citadel@localhost:55433/cc_check npx vitest run lib/tasks/__tests__/checklist.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';

const hdr = vi.hoisted(() => ({ headers: {} as Record<string, string> }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => ({ get: (n: string) => hdr.headers[n.toLowerCase()] ?? null })),
}));

import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from '@/lib/auth/api-keys';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { POST as checklistPost } from '@/app/api/tasks/[id]/checklist/route';
import { loadHomeInputs } from '@/lib/home/load';

const SCRATCH = /localhost:55433/.test(process.env.DATABASE_URL ?? '');

describe.skipIf(!SCRATCH)('task checklist route', () => {
  const tag = `cl-${Date.now()}`;
  const keys = { owner: `ck_${tag}_owner`, bast: `ck_${tag}_bast`, chat: `ck_${tag}_chat`, porter: `ck_${tag}_porter` };
  let ownerId = '';
  let createdBast = false;
  const taskIds: string[] = [];
  let mineId = '';
  let botTaskId = '';
  const items = [
    { id: 'i-1', type: 'item', text: 'Rule: nine or ten trustees', completed: false, sort_order: 0 },
    { id: 'i-2', type: 'item', text: 'Send the draft', completed: false, sort_order: 1 },
  ];
  const call = async (key: keyof typeof keys, taskId: string, body: unknown, route = true) => {
    const path = '/api/tasks/' + taskId + '/checklist';
    hdr.headers = { authorization: `Bearer ${keys[key]}`, ...(route ? { 'x-citadel-route': `POST ${path}` } : {}) };
    return checklistPost(new NextRequest(`http://localhost:3000${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), { params: Promise.resolve({ id: taskId }) });
  };
  const mkKey = (userId: string, raw: string, scopes: string[] = []) => prisma.apiKey.create({ data: { user_id: userId, name: raw, key_hash: hashApiKey(raw), key_prefix: raw.slice(0, 12), scopes } });
  const reqs = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id }, select: { requirements: true } })).requirements as { id: string; completed: boolean; completed_by: string | null }[];

  beforeAll(async () => {
    ownerId = randomUUID();
    await prisma.user.create({ data: { id: ownerId, email: `owner-${tag}@example.test`, password_hash: 'x', name: 'Owner CL', role: 'admin' } });
    if (!(await prisma.user.findUnique({ where: { id: BAST_USER_ID } }))) {
      createdBast = true;
      await prisma.user.create({ data: { id: BAST_USER_ID, email: 'bast@becomeindelible.com', password_hash: 'x', name: 'Bast CL', role: 'pm' } });
    }
    await mkKey(ownerId, keys.owner);
    await mkKey(BAST_USER_ID, keys.bast);
    await mkKey(BAST_USER_ID, keys.chat, ['lane:bast-chat', 'scope-mode:enforce']);
    await mkKey(BAST_USER_ID, keys.porter, ['lane:porter', 'scope-mode:enforce']);
    const a = await prisma.task.create({ data: { title: `Mine ${tag}`, status: 'in_progress', assignee_id: ownerId, tags: [], requirements: items } as never });
    const b = await prisma.task.create({ data: { title: `Bots ${tag}`, status: 'in_progress', assignee_id: BAST_USER_ID, tags: [], requirements: items } as never });
    mineId = a.id;
    botTaskId = b.id;
    taskIds.push(a.id, b.id);
  });

  afterAll(async () => {
    await prisma.comment.deleteMany({ where: { task_id: { in: taskIds } } });
    await prisma.notification.deleteMany({ where: { entity_id: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await prisma.apiKey.deleteMany({ where: { name: { startsWith: `ck_${tag}` } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    if (createdBast) await prisma.user.deleteMany({ where: { id: BAST_USER_ID } });
    await prisma.$disconnect();
  });

  it('ticks and unticks one item and leaves the other alone', async () => {
    expect((await call('owner', mineId, { item_id: 'i-1', completed: true }, false)).status).toBe(200);
    let r = await reqs(mineId);
    expect(r[0]).toMatchObject({ completed: true, completed_by: ownerId });
    expect(r[1].completed).toBe(false);
    expect((await call('owner', mineId, { item_id: 'i-1', completed: false }, false)).status).toBe(200);
    r = await reqs(mineId);
    expect(r[0]).toMatchObject({ completed: false, completed_by: null });
  });

  it('an answer stores one internal comment with the item id and ticks the item, in one call', async () => {
    const res = await call('owner', mineId, { item_id: 'i-1', answer: 'Ten trustees.' }, false);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ item_id: 'i-1', completed: true });
    const c = await prisma.comment.findUniqueOrThrow({ where: { id: body.comment_id } });
    expect(c).toMatchObject({ content: 'Answer on "Rule: nine or ten trustees": Ten trustees.', user_id: ownerId, is_internal: true, client_visible: false, client_question: false });
    expect(c.chat_meta).toEqual({ checklist: { item_id: 'i-1' } });
    expect((await reqs(mineId))[0].completed).toBe(true);
  });

  it('the home load hands the card the id, the tick and the saved answer', async () => {
    const { tasks } = await loadHomeInputs(prisma, ownerId, new Date());
    const t = tasks.find((x) => x.id === mineId)!;
    expect(t.requirements).toEqual([
      { text: 'Rule: nine or ten trustees', completed: true, id: 'i-1', answer: 'Ten trustees.' },
      { text: 'Send the draft', completed: false, id: 'i-2' },
    ]);
  });

  it('refuses an unknown item (404), an empty body (400) and an unknown field (400), and writes nothing', async () => {
    const before = await prisma.comment.count({ where: { task_id: mineId } });
    expect((await call('owner', mineId, { item_id: 'nope', completed: true }, false)).status).toBe(404);
    expect((await call('owner', mineId, { item_id: 'i-2' }, false)).status).toBe(400);
    expect((await call('owner', mineId, { item_id: 'i-2', completed: true, user_id: 'x' }, false)).status).toBe(400);
    expect((await call('owner', mineId, { item_id: 'i-2', answer: 'x'.repeat(2001) }, false)).status).toBe(400);
    expect(await prisma.comment.count({ where: { task_id: mineId } })).toBe(before);
  });

  it('the Bast service key with no lane (as production has it): answers on the owner task, comment says it speaks for him; refused on a task a bot holds', async () => {
    const res = await call('bast', mineId, { item_id: 'i-2', answer: 'Sent.' }, false);
    expect(res.status).toBe(200);
    const c = await prisma.comment.findUniqueOrThrow({ where: { id: (await res.json()).comment_id } });
    expect(c.content).toBe('From Mike, through the chat: Answer on "Send the draft": Sent.');
    expect(c).toMatchObject({ user_id: BAST_USER_ID, is_internal: true, client_visible: false });
    const held = await call('bast', botTaskId, { item_id: 'i-1', completed: true }, false);
    expect(held.status).toBe(409);
    expect((await reqs(botTaskId))[0].completed).toBe(false);
  });

  it('the bast-chat lane key passes the lane check for this route; another enforced lane does not', async () => {
    expect((await call('chat', mineId, { item_id: 'i-2', completed: false })).status).toBe(200);
    expect((await reqs(mineId))[1].completed).toBe(false);
    expect((await call('porter', mineId, { item_id: 'i-2', completed: true })).status).toBe(403);
    expect((await reqs(mineId))[1].completed).toBe(false); // the refused call changed nothing
  });
});
