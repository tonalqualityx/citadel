import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    task: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    clientContact: { findUnique: vi.fn() },
  },
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockTaskFindUnique = prisma.task.findUnique as Mock;
const mockUserFindUnique = prisma.user.findUnique as Mock;
const mockContactFindUnique = prisma.clientContact.findUnique as Mock;

const PROJECT_ID = '33333333-3333-3333-8333-333333333333';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/oracle/projects/nudge-draft', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'mike-1', role: 'admin', email: 'mike@becomeindelible.com' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Website Redesign' });
  mockTaskFindUnique.mockResolvedValue({ title: 'Build the contact form' });
  mockUserFindUnique.mockResolvedValue({ id: '55555555-5555-5555-8555-555555555555', name: 'Andy' });
  mockContactFindUnique.mockResolvedValue({ id: '22222222-2222-2222-8222-222222222222', email: 'client@acme.com', name: 'Client', is_deleted: false });
});

describe('POST /api/oracle/projects/nudge-draft', () => {
  it('requires PM or Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });
    const res = await POST(req({ blocker_id: 'someone_else:task-1', project_id: PROJECT_ID, owner: { user_id: '55555555-5555-5555-8555-555555555555' } }));
    expect(res.status).toBe(403);
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await POST(req({ blocker_id: 'someone_else:task-1', project_id: PROJECT_ID, owner: { user_id: '55555555-5555-5555-8555-555555555555' } }));
    expect(res.status).toBe(404);
  });

  it('400s when more than one owner field is given', async () => {
    const res = await POST(
      req({ blocker_id: 'someone_else:task-1', project_id: PROJECT_ID, owner: { user_id: '55555555-5555-5555-8555-555555555555', label: 'Contractor' } })
    );
    expect(res.status).toBe(400);
  });

  it("returns channel:'comment' for a User owner, naming the task from the parsed blocker_id", async () => {
    const res = await POST(req({ blocker_id: 'someone_else:task-1', project_id: PROJECT_ID, owner: { user_id: '55555555-5555-5555-8555-555555555555' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel).toBe('comment');
    expect(body.to).toBe('Andy');
    expect(body.body).toContain('Build the contact form');
  });

  it('404s a User owner that does not exist', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const res = await POST(req({ blocker_id: 'someone_else:task-1', project_id: PROJECT_ID, owner: { user_id: '55555555-5555-5555-8555-555555555555' } }));
    expect(res.status).toBe(404);
  });

  it("returns channel:'email' for a ClientContact owner", async () => {
    const res = await POST(
      req({ blocker_id: 'client_approval:ar-1', project_id: PROJECT_ID, owner: { contact_id: '22222222-2222-2222-8222-222222222222' } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel).toBe('email');
    expect(body.to).toBe('client@acme.com');
    expect(body.subject).toBeDefined();
  });

  it('404s a ClientContact owner that does not exist', async () => {
    mockContactFindUnique.mockResolvedValue(null);
    const res = await POST(
      req({ blocker_id: 'client_approval:ar-1', project_id: PROJECT_ID, owner: { contact_id: '22222222-2222-2222-8222-222222222222' } })
    );
    expect(res.status).toBe(404);
  });

  it("returns channel:'email' with an EMPTY to and a fill-in note for a label-only owner", async () => {
    const res = await POST(
      req({ blocker_id: 'stale:' + PROJECT_ID, project_id: PROJECT_ID, owner: { label: 'Freelance designer' } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel).toBe('email');
    expect(body.to).toBe('');
    expect(body.body).toContain('Freelance designer');
  });

  it('falls back to the project name when the blocker_id has no resolvable task', async () => {
    mockTaskFindUnique.mockResolvedValue(null);
    const res = await POST(req({ blocker_id: 'someone_else:unknown-task', project_id: PROJECT_ID, owner: { user_id: '55555555-5555-5555-8555-555555555555' } }));
    const body = await res.json();
    expect(body.body).toContain('Website Redesign');
  });
});
