import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { PATCH } from '../route';
import { POST as createProject } from '../../route';

// Projects: initiative_id sets, clears (null), and refuses a missing or deleted initiative, on update and on create.

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    client: { findUnique: vi.fn() },
    site: { findUnique: vi.fn() },
    initiative: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/api/formatters', () => ({
  formatProjectResponse: vi.fn((project) => ({ ...project })),
}));

vi.mock('@/lib/calculations/status', () => ({
  canTransitionProjectStatus: vi.fn(() => true),
}));

vi.mock('@/lib/engagement/ensure-brief', () => ({ ensureProjectBrief: vi.fn() }));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const INITIATIVE = '33333333-3333-4333-8333-333333333333';
const CLIENT = '55555555-5555-4555-8555-555555555555';

const patch = (body: object) =>
  new NextRequest('http://localhost/api/projects/proj-1', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const create = (body: object) =>
  new NextRequest('http://localhost/api/projects', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const params = () => ({ params: Promise.resolve({ id: 'proj-1' }) });

const projectRow = (o: Record<string, unknown> = {}) => ({
  id: 'proj-1', name: 'P', status: 'in_progress', type: 'project', client_id: CLIENT, client: null, site: null,
  initiative_id: null, tasks: [], created_at: new Date(), updated_at: new Date(), ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'user-1', email: 'a@b.c', role: 'pm' });
});

describe('PATCH project: initiative_id', () => {
  it('links to an existing initiative and returns initiative_id', async () => {
    p.initiative.findFirst.mockResolvedValue({ id: INITIATIVE });
    p.project.update.mockResolvedValue(projectRow({ initiative_id: INITIATIVE }));
    const res = await PATCH(patch({ initiative_id: INITIATIVE }), params());
    expect(res.status).toBe(200);
    expect(p.initiative.findFirst).toHaveBeenCalledWith({ where: { id: INITIATIVE, is_deleted: false }, select: { id: true } });
    expect(p.project.update.mock.calls[0][0].data).toEqual({ initiative_id: INITIATIVE });
    expect((await res.json()).initiative_id).toBe(INITIATIVE);
  });

  it('clears the link with null, without an existence check', async () => {
    p.project.update.mockResolvedValue(projectRow());
    const res = await PATCH(patch({ initiative_id: null }), params());
    expect(res.status).toBe(200);
    expect(p.initiative.findFirst).not.toHaveBeenCalled();
    expect(p.project.update.mock.calls[0][0].data).toEqual({ initiative_id: null });
    expect((await res.json()).initiative_id).toBeNull();
  });

  it('404s and writes nothing for a missing or deleted initiative', async () => {
    p.initiative.findFirst.mockResolvedValue(null);
    const res = await PATCH(patch({ initiative_id: INITIATIVE }), params());
    expect(res.status).toBe(404);
    expect(p.project.update).not.toHaveBeenCalled();
  });

  it('leaves the link alone when absent', async () => {
    p.project.update.mockResolvedValue(projectRow());
    await PATCH(patch({ name: 'Renamed' }), params());
    expect(p.project.update.mock.calls[0][0].data).not.toHaveProperty('initiative_id');
  });
});

describe('create project: initiative_id', () => {
  it('creates a project linked to an initiative', async () => {
    p.client.findUnique.mockResolvedValue({ id: CLIENT });
    p.initiative.findFirst.mockResolvedValue({ id: INITIATIVE });
    p.project.create.mockResolvedValue(projectRow({ initiative_id: INITIATIVE }));
    const res = await createProject(create({ name: 'P', client_id: CLIENT, initiative_id: INITIATIVE }));
    expect(res.status).toBe(201);
    expect(p.project.create.mock.calls[0][0].data.initiative_id).toBe(INITIATIVE);
    expect((await res.json()).initiative_id).toBe(INITIATIVE);
  });

  it('refuses a missing initiative on create', async () => {
    p.client.findUnique.mockResolvedValue({ id: CLIENT });
    p.initiative.findFirst.mockResolvedValue(null);
    const res = await createProject(create({ name: 'P', client_id: CLIENT, initiative_id: INITIATIVE }));
    expect(res.status).toBe(404);
    expect(p.project.create).not.toHaveBeenCalled();
  });
});
