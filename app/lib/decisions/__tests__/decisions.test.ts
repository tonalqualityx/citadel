import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => {
  const decision = { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() };
  const decisionSource = { createMany: vi.fn() };
  const decisionLink = { createMany: vi.fn() };
  const task = { findUnique: vi.fn() };
  const project = { findUnique: vi.fn() };
  const charter = { findUnique: vi.fn() };
  const tx = { decision };
  return {
    prisma: {
      decision,
      decisionSource,
      decisionLink,
      task,
      project,
      charter,
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

import { prisma } from '@/lib/db/prisma';
import { findInScope, importDecisions, supersede, IN_SCOPE_CAP, importItemSchema } from '../index';

const dFindMany = prisma.decision.findMany as Mock;
const dFindUnique = prisma.decision.findUnique as Mock;
const dFindFirst = prisma.decision.findFirst as Mock;
const dCreate = prisma.decision.create as Mock;
const dUpdate = prisma.decision.update as Mock;
const srcCreateMany = prisma.decisionSource.createMany as Mock;
const linkCreateMany = prisma.decisionLink.createMany as Mock;
const taskFindUnique = prisma.task.findUnique as Mock;
const projectFindUnique = prisma.project.findUnique as Mock;
const txMock = prisma.$transaction as unknown as Mock;

const CLIENT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'd-' + Math.random().toString(36).slice(2),
    key: null,
    title: 't',
    text: 'x',
    kind: 'ruling',
    status: 'confirmed',
    scope: 'fleet',
    lane: null,
    client_id: null,
    project_id: null,
    charter_id: null,
    site_id: null,
    accord_id: null,
    author_user_id: null,
    author_contact_id: null,
    ruled_at: null,
    revision: 1,
    supersedes_id: null,
    conflict_note: null,
    confidence: null,
    confirmed_by_user_id: null,
    confirmed_at: null,
    created_by_id: null,
    tags: [],
    created_at: new Date('2026-10-01'),
    updated_at: new Date('2026-10-01'),
    sources: [],
    links: [],
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  txMock.mockImplementation(async (fn: (t: unknown) => unknown) => fn({ decision: prisma.decision }));
});

describe('findInScope', () => {
  it('asks for active decisions only and includes fleet, lane, client, project and task-link clauses', async () => {
    taskFindUnique.mockResolvedValue({ project_id: PROJECT, client_id: CLIENT, charter_id: null, site_id: null, accord_id: null });
    dFindMany.mockResolvedValue([]);
    await findInScope({ task: TASK, lane: 'wright' });
    const args = dFindMany.mock.calls[0][0];
    expect(args.where.status).toEqual({ in: ['recorded_from_source', 'confirmed'] });
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { scope: 'fleet' },
        { scope: 'lane', lane: 'wright' },
        { scope: 'client', client_id: CLIENT },
        { scope: 'project', project_id: PROJECT },
      ])
    );
    const linkClause = args.where.OR.find((c: Record<string, unknown>) => 'links' in c);
    expect(linkClause.links.some.OR).toEqual(
      expect.arrayContaining([
        { entity_kind: 'task', entity_id: TASK },
        { entity_kind: 'project', entity_id: PROJECT },
        { entity_kind: 'client', entity_id: CLIENT },
      ])
    );
  });

  it('excludes other scopes: no lane clause without a lane, no client clause without a client', async () => {
    dFindMany.mockResolvedValue([]);
    await findInScope({ project: PROJECT });
    projectFindUnique.mockResolvedValue({ client_id: null });
    const clauses = dFindMany.mock.calls[0][0].where.OR as Array<Record<string, unknown>>;
    expect(clauses.some((c) => c.scope === 'lane')).toBe(false);
    expect(clauses.some((c) => c.scope === 'client')).toBe(false);
    expect(clauses.some((c) => c.scope === 'project')).toBe(true);
  });

  it('returns a task-linked decision first, then narrower scopes before wider ones', async () => {
    dFindMany.mockResolvedValue([
      row({ id: 'fleet', scope: 'fleet' }),
      row({ id: 'client', scope: 'client', client_id: CLIENT }),
      row({ id: 'project', scope: 'project', project_id: PROJECT }),
      row({ id: 'linked', scope: 'fleet', links: [{ id: 'l', entity_kind: 'task', entity_id: TASK, relation: 'governs', created_at: new Date() }] }),
    ]);
    taskFindUnique.mockResolvedValue({ project_id: PROJECT, client_id: CLIENT, charter_id: null, site_id: null, accord_id: null });
    const r = await findInScope({ task: TASK });
    expect(r.decisions.map((d) => d.id)).toEqual(['linked', 'project', 'client', 'fleet']);
  });

  it('caps at 60 and says so', async () => {
    dFindMany.mockResolvedValue(Array.from({ length: 75 }, (_, i) => row({ id: `d${i}` })));
    const r = await findInScope({ lane: 'wright' });
    expect(r.decisions).toHaveLength(IN_SCOPE_CAP);
    expect(r.truncated).toBe(true);
    expect(r.total_matched).toBe(75);
  });

  it('is not truncated at exactly 60', async () => {
    dFindMany.mockResolvedValue(Array.from({ length: 60 }, (_, i) => row({ id: `d${i}` })));
    const r = await findInScope({ lane: 'wright' });
    expect(r.truncated).toBe(false);
  });
});

describe('supersede', () => {
  it('runs in one transaction: old becomes superseded, new points at old and moves its revision', async () => {
    dFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'old' ? row({ id: 'old', revision: 2 }) : row({ id: 'new', status: 'recorded_from_source', revision: 1 })
    );
    dFindFirst.mockResolvedValue(null);
    dUpdate.mockResolvedValue(row({ id: 'new', supersedes_id: 'old', revision: 3 }));
    await supersede('old', 'new');
    expect(txMock).toHaveBeenCalledTimes(1);
    expect(dUpdate).toHaveBeenCalledWith({ where: { id: 'old' }, data: { status: 'superseded' } });
    expect(dUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'new' }, data: { supersedes_id: 'old', revision: 3 } }));
  });

  it('refuses an already superseded decision and writes nothing', async () => {
    dFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'old' ? row({ id: 'old', status: 'superseded' }) : row({ id: 'new' })
    );
    await expect(supersede('old', 'new')).rejects.toMatchObject({ statusCode: 409 });
    expect(dUpdate).not.toHaveBeenCalled();
  });

  it('refuses self-supersession', async () => {
    await expect(supersede('a', 'a')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('importDecisions', () => {
  const item = importItemSchema.parse({
    key: 'pipeline.1',
    title: 'T',
    text: 'Body',
    status: 'confirmed',
    sources: [{ kind: 'doc', ref: '/a.md#L1', quote: 'Body' }],
  });

  it('creates a new key as confirmed with the importer as confirmer', async () => {
    dFindUnique.mockResolvedValue(null);
    dCreate.mockResolvedValue(row({ id: 'n1', key: 'pipeline.1' }));
    srcCreateMany.mockResolvedValue({ count: 1 });
    const r = await importDecisions([item], 'user-1');
    expect(r.created).toBe(1);
    const data = dCreate.mock.calls[0][0].data;
    expect(data.status).toBe('confirmed');
    expect(data.confirmed_by_user_id).toBe('user-1');
  });

  it('a second identical run changes nothing', async () => {
    dFindUnique.mockResolvedValue(
      row({ id: 'n1', key: 'pipeline.1', title: 'T', text: 'Body', lane: null, conflict_note: null })
    );
    srcCreateMany.mockResolvedValue({ count: 0 });
    linkCreateMany.mockResolvedValue({ count: 0 });
    const r = await importDecisions([item], 'user-1');
    expect(r).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(dCreate).not.toHaveBeenCalled();
    expect(dUpdate).not.toHaveBeenCalled();
    expect(srcCreateMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('never rewrites the status of an existing row', async () => {
    dFindUnique.mockResolvedValue(row({ id: 'n1', key: 'pipeline.1', title: 'Old title', text: 'Body', status: 'retracted' }));
    srcCreateMany.mockResolvedValue({ count: 0 });
    await importDecisions([item], 'user-1');
    expect(dUpdate).not.toHaveBeenCalled();
  });
});
