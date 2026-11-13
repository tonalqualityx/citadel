// @vitest-environment node
/** The one hour default through PATCH /api/tasks/:id/triage, for Mike's session and the triage-desk lane, against a scratch Postgres. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));
vi.mock('@/lib/auth/actor-lane', () => ({ actorLaneField: vi.fn(async () => ({})), currentActorLane: vi.fn(async () => null) }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth, type AuthPayload } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { PATCH as patchTriage } from '@/app/api/tasks/[id]/triage/route';
import { idParams, makeFixture, BOT_ID, mikeSession, chatLane, type Fx } from '@/lib/dox/__tests__/fixture';
import { calculateEstimatedMinutes } from '@/lib/calculations/energy';

const as = (a: AuthPayload) => (requireAuth as Mock).mockResolvedValue(a);
const desk = (): AuthPayload => ({ userId: BOT_ID, role: 'pm', email: 'bast@becomeindelible.com', via: 'api_key', apiKeyId: 'kt', lane: 'triage-desk', laneEnforced: true });
const patch = (id: string, body: unknown) => patchTriage(new NextRequest('http://localhost/api/x', { method: 'PATCH', body: JSON.stringify(body) }), idParams(id));

describe.skipIf(!SCRATCH)('project setup cards default to one hour (real database)', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await makeFixture('est');
  });
  afterAll(async () => {
    await prisma.comment.deleteMany({ where: { task_id: { in: fx.taskIds } } });
    await fx.cleanup();
    await prisma.$disconnect();
  });
  const row = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
  const calc = (r: Awaited<ReturnType<typeof row>>) => calculateEstimatedMinutes(r.energy_estimate, r.mystery_factor, r.battery_impact);

  it.each([['Mike', mikeSession], ['the chat lane', chatLane], ['the triage desk', desk]])('%s: null becomes 60 (stored and calculated), and moving away clears it', async (_n, who) => {
    const id = await fx.mkTask('Card', { status: 'triage' });
    as(who());
    expect((await patch(id, { kind: 'project_setup' })).status).toBe(200);
    let r = await row(id);
    expect([r.estimated_minutes, calc(r)]).toEqual([60, 60]);
    expect((await patch(id, { kind: 'task' })).status).toBe(200);
    r = await row(id);
    expect([r.estimated_minutes, r.energy_estimate, r.battery_impact, r.tags]).toEqual([null, null, 'average_drain', []]);
  });

  it('an existing estimate is kept, and a value set after the default survives a change of kind', async () => {
    const kept = await fx.mkTask('Has an estimate', { status: 'triage', energy_estimate: 4, estimated_minutes: 132, battery_impact: 'high_drain' });
    as(mikeSession());
    await patch(kept, { kind: 'project_setup' });
    expect((await row(kept)).estimated_minutes).toBe(132);
    const later = await fx.mkTask('Set later', { status: 'triage' });
    await patch(later, { kind: 'project_setup' });
    await prisma.task.update({ where: { id: later }, data: { energy_estimate: 5, estimated_minutes: 240, mystery_factor: 'none', battery_impact: 'energizing' } });
    await patch(later, { kind: 'question_only' });
    expect((await row(later)).estimated_minutes).toBe(240);
  });
});
