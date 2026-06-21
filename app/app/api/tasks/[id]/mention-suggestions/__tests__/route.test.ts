import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';

// Mock the auth middleware
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    clientContact: { findMany: vi.fn() },
    projectTeamAssignment: { findFirst: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = vi.mocked(requireAuth);
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockUserFindMany = prisma.user.findMany as Mock;
const mockContactFindMany = prisma.clientContact.findMany as Mock;
const mockTeamAssignmentFindFirst = prisma.projectTeamAssignment.findFirst as Mock;

const PM = '11111111-1111-4111-8111-111111111111';
const TECH = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_ID = 'task-1';

function getRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/tasks/${TASK_ID}/mention-suggestions`,
    { method: 'GET' }
  );
}

const ctx = { params: Promise.resolve({ id: TASK_ID }) };

const TEAM = [
  { id: PM, name: 'Mike', email: 'mike@x.com', role: 'pm', avatar_url: null },
  { id: TECH, name: 'Bast', email: 'bast@x.com', role: 'tech', avatar_url: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: PM, role: 'pm' } as never);
  mockTaskFindUnique.mockResolvedValue({
    id: TASK_ID,
    project_id: null,
    assignee_id: PM,
    client_id: CLIENT_ID,
  });
  mockUserFindMany.mockResolvedValue(TEAM);
  mockContactFindMany.mockResolvedValue([
    { id: 'c1', name: 'Nicole Relevant', email: 'nicole@thisclient.com', role: 'Owner', is_primary: true },
  ]);
});

describe('GET /api/tasks/[id]/mention-suggestions', () => {
  it('returns active team members plus only this task client\'s contacts', async () => {
    const res = await GET(getRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.users).toHaveLength(2);
    expect(body.contacts).toEqual([
      { id: 'c1', name: 'Nicole Relevant', email: 'nicole@thisclient.com', role: 'Owner', is_primary: true },
    ]);

    // Users scoped to active only.
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { is_active: true } })
    );
    // Contacts scoped to THIS task's client only, excluding soft-deleted.
    expect(mockContactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { client_id: CLIENT_ID, is_deleted: false },
      })
    );
  });

  it('falls back to email for contacts with no name', async () => {
    mockContactFindMany.mockResolvedValue([
      { id: 'c2', name: null, email: 'noname@thisclient.com', role: null, is_primary: false },
    ]);

    const res = await GET(getRequest(), ctx);
    const body = await res.json();
    expect(body.contacts[0].name).toBe('noname@thisclient.com');
  });

  it('returns no contacts for an ad-hoc task without a client', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: TASK_ID,
      project_id: null,
      assignee_id: PM,
      client_id: null,
    });

    const res = await GET(getRequest(), ctx);
    const body = await res.json();
    expect(body.contacts).toEqual([]);
    // Never queries contacts when there is no client.
    expect(mockContactFindMany).not.toHaveBeenCalled();
    expect(body.users).toHaveLength(2);
  });

  it('404s when the task does not exist', async () => {
    mockTaskFindUnique.mockResolvedValue(null);
    const res = await GET(getRequest(), ctx);
    expect(res.status).toBe(404);
  });

  it('404s for a tech user without access to the task', async () => {
    mockRequireAuth.mockResolvedValue({ userId: TECH, role: 'tech' } as never);
    // Project task where the tech is not a team member.
    mockTaskFindUnique.mockResolvedValue({
      id: TASK_ID,
      project_id: 'proj-1',
      assignee_id: PM,
      client_id: CLIENT_ID,
    });
    mockTeamAssignmentFindFirst.mockResolvedValue(null);

    const res = await GET(getRequest(), ctx);
    expect(res.status).toBe(404);
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('allows a tech user who is a project team member', async () => {
    mockRequireAuth.mockResolvedValue({ userId: TECH, role: 'tech' } as never);
    mockTaskFindUnique.mockResolvedValue({
      id: TASK_ID,
      project_id: 'proj-1',
      assignee_id: PM,
      client_id: CLIENT_ID,
    });
    mockTeamAssignmentFindFirst.mockResolvedValue({ id: 'assignment-1' });

    const res = await GET(getRequest(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toHaveLength(2);
    expect(body.contacts).toHaveLength(1);
  });
});
