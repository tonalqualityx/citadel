// @vitest-environment node
/** The card-pass backfill migration, run against a scratch Postgres: it marks the card a Dox-made project came from, and nothing else. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', async (orig) => ({ ...(await orig<typeof import('@/lib/auth/middleware')>()), requireAuth: vi.fn() }));

import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { SCRATCH } from '@/lib/engine/__tests__/seed';
import { GET as projectPlan } from '@/app/api/projects/[id]/plan/route';
import { DOX_USER_ID } from '../identity';
import { mikeSession, idParams, makeFixture, type Fx } from './fixture';

const SQL = readFileSync(join(process.cwd(), 'prisma/migrations/20261209100000_dox_card_pass_setup_kind_backfill/migration.sql'), 'utf8');
const runMigration = () => prisma.$executeRawUnsafe(SQL);
const kindOf = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id }, select: { triage_kind: true } })).triage_kind;
const HOUR = 3600 * 1000;

describe.skipIf(!SCRATCH)('Dox card-pass setup-kind backfill (real database)', () => {
  let fx: Fx;
  let good: string, goodCard: string;
  let hasSetup: string, otherCard: string, existingSetup: string;
  let noPassCard: string;
  let byPerson: string, personCard: string;
  let ambiguous: string, ambA: string, ambB: string;

  // a Dox-made project created now, whose card pass started an hour earlier
  const mkCardProject = async (name: string, createdBy: string | null = DOX_USER_ID) => {
    const project = await fx.mkProject(name, { status: 'ready', created_by_id: createdBy });
    return project;
  };
  const mkCard = async (title: string, project: string, withPass: boolean, extra: Record<string, unknown> = {}) => {
    const card = await fx.mkTask(title, { project_id: project, status: 'not_started', tags: ['from-triage'], ...extra });
    if (withPass) await fx.openCardPass(card, 'dox', { started_at: new Date(Date.now() - HOUR) });
    return card;
  };

  beforeAll(async () => {
    fx = await makeFixture('doxbf');
    await prisma.user.upsert({ where: { id: DOX_USER_ID }, update: {}, create: { id: DOX_USER_ID, email: `dox-${fx.tag}@example.test`, password_hash: 'x', name: 'Dox', role: 'pm' } });

    good = await mkCardProject('Good');
    goodCard = await mkCard('Good card', good, true);
    await fx.mkTask('Other from-triage task, no pass', { project_id: good, tags: ['from-triage'] });

    hasSetup = await mkCardProject('Has setup');
    existingSetup = await mkCard('Existing setup', hasSetup, false, { triage_kind: 'project_setup' });
    otherCard = await mkCard('Another card with a pass', hasSetup, true);

    const noPass = await mkCardProject('No pass');
    noPassCard = await mkCard('No pass card', noPass, false);

    byPerson = await mkCardProject('By a person', null);
    personCard = await mkCard('Person card', byPerson, true);

    ambiguous = await mkCardProject('Ambiguous');
    ambA = await mkCard('Amb A', ambiguous, true);
    ambB = await mkCard('Amb B', ambiguous, true);
  }, 60_000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it('marks the card a Dox project came from, so the plan endpoint finds it', async () => {
    await runMigration();
    expect(await kindOf(goodCard)).toBe('project_setup');
    (requireAuth as Mock).mockResolvedValue(mikeSession());
    const res = await projectPlan(new NextRequest('http://localhost/api/x'), idParams(good));
    const body = (await res.json()) as { task_id?: string };
    expect([res.status, body.task_id]).toEqual([200, goodCard]);
  });

  it('a second run changes nothing', async () => {
    const before = await prisma.task.findUniqueOrThrow({ where: { id: goodCard }, select: { updated_at: true } });
    await runMigration();
    const after = await prisma.task.findUniqueOrThrow({ where: { id: goodCard }, select: { updated_at: true, triage_kind: true } });
    expect(after.triage_kind).toBe('project_setup');
    expect(after.updated_at).toEqual(before.updated_at);
  });

  it('leaves alone a project with a setup card, a task with no card pass, a project not made by Dox and an ambiguous project', async () => {
    await runMigration();
    expect(await kindOf(existingSetup)).toBe('project_setup');
    expect(await kindOf(otherCard)).toBeNull();
    expect(await kindOf(noPassCard)).toBeNull();
    expect(await kindOf(personCard)).toBeNull();
    expect(await kindOf(ambA)).toBeNull();
    expect(await kindOf(ambB)).toBeNull();
  });
});
