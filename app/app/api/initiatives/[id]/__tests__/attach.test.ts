import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST as ATTACH } from '../attach/route';
import { POST as DETACH } from '../detach/route';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    initiative: { findFirst: vi.fn() },
    project: { findFirst: vi.fn(), update: vi.fn() },
    task: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const p = prisma as unknown as Record<string, Record<string, Mock>>;
const INIT = '33333333-3333-4333-8333-333333333333';
const OTHER = '55555555-5555-4555-8555-555555555555';
const PROJ = '66666666-6666-4666-8666-666666666666';
const TASK = '77777777-7777-4777-8777-777777777777';
const req = (path: string, body: object) => new NextRequest(`http://localhost/api/initiatives/${INIT}/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const ctx = { params: Promise.resolve({ id: INIT }) };

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as Mock).mockResolvedValue({ userId: 'u1', role: 'pm' });
  (requireRole as Mock).mockReturnValue(undefined);
  p.initiative.findFirst.mockResolvedValue({ id: INIT });
  p.project.findFirst.mockResolvedValue({ id: PROJ, name: 'ADA outreach', initiative_id: null });
  p.task.findFirst.mockResolvedValue({ id: TASK, title: 'Pitch agencies', initiative_id: null });
});

describe('POST /api/initiatives/[id]/attach', () => {
  it('links a project and writes only initiative_id', async () => {
    const res = await ATTACH(req('attach', { project_id: PROJ }), ctx);
    expect(res.status).toBe(200);
    expect(p.project.update).toHaveBeenCalledWith({ where: { id: PROJ }, data: { initiative_id: INIT } });
    expect(await res.json()).toMatchObject({ attached: true, kind: 'project', name: 'ADA outreach', moved_from: null });
  });

  it('links a task, and reports a move from another initiative', async () => {
    p.task.findFirst.mockResolvedValue({ id: TASK, title: 'Pitch agencies', initiative_id: OTHER });
    const res = await ATTACH(req('attach', { task_id: TASK }), ctx);
    expect(p.task.update).toHaveBeenCalledWith({ where: { id: TASK }, data: { initiative_id: INIT } });
    expect(await res.json()).toMatchObject({ kind: 'task', moved_from: OTHER });
  });

  it('needs exactly one of project_id or task_id, and no other field', async () => {
    expect((await ATTACH(req('attach', {}), ctx)).status).toBe(400);
    expect((await ATTACH(req('attach', { project_id: PROJ, task_id: TASK }), ctx)).status).toBe(400);
    expect((await ATTACH(req('attach', { project_id: PROJ, status: 'done' }), ctx)).status).toBe(400);
    expect(p.project.update).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown initiative, project or task', async () => {
    p.initiative.findFirst.mockResolvedValue(null);
    expect((await ATTACH(req('attach', { project_id: PROJ }), ctx)).status).toBe(404);
    p.initiative.findFirst.mockResolvedValue({ id: INIT });
    p.project.findFirst.mockResolvedValue(null);
    expect((await ATTACH(req('attach', { project_id: PROJ }), ctx)).status).toBe(404);
    p.task.findFirst.mockResolvedValue(null);
    expect((await ATTACH(req('attach', { task_id: TASK }), ctx)).status).toBe(404);
  });
});

describe('POST /api/initiatives/[id]/detach', () => {
  it('clears the link when it points at this initiative', async () => {
    p.project.findFirst.mockResolvedValue({ id: PROJ, name: 'ADA outreach', initiative_id: INIT });
    const res = await DETACH(req('detach', { project_id: PROJ }), ctx);
    expect(res.status).toBe(200);
    expect(p.project.update).toHaveBeenCalledWith({ where: { id: PROJ }, data: { initiative_id: null } });
    expect(await res.json()).toMatchObject({ attached: false });
  });

  it('answers 409 and changes nothing when it is attached elsewhere or nowhere', async () => {
    p.task.findFirst.mockResolvedValue({ id: TASK, title: 'x', initiative_id: OTHER });
    const elsewhere = await DETACH(req('detach', { task_id: TASK }), ctx);
    expect(elsewhere.status).toBe(409);
    p.task.findFirst.mockResolvedValue({ id: TASK, title: 'x', initiative_id: null });
    expect((await DETACH(req('detach', { task_id: TASK }), ctx)).status).toBe(409);
    expect(p.task.update).not.toHaveBeenCalled();
  });
});
