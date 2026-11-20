import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn(), requireRole: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    emailAsk: { findMany: vi.fn() },
    taskQuestion: { findMany: vi.fn() },
    meeting: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { GET } from '../route';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';

const req = () => new NextRequest('http://localhost:3000/api/projects/proj-1/communication');
const params = Promise.resolve({ id: 'proj-1' });

describe('GET /api/projects/:id/communication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as Mock).mockResolvedValue({ userId: 'u1', email: 'pm@x.com', role: 'pm' });
    (requireRole as Mock).mockImplementation(() => undefined);
    (prisma.project.findUnique as Mock).mockResolvedValue({ id: 'proj-1' });
    (prisma.emailAsk.findMany as Mock).mockResolvedValue([
      {
        id: 'e1', message_id: 'gm-1', rfc_message_id: 'a@b', account: 'mike@becomeindelible.com', from_name: 'Dan', from_email: 'dan@x.com',
        subject: 'Hero photo', gist: 'Wants more of the photo', deep_link: 'https://mail.google.com/mail/u/0/#inbox/18c1',
        received_at: new Date('2026-11-10T10:00:00Z'), task: { id: 't1', title: 'Hero' },
      },
    ]);
    (prisma.taskQuestion.findMany as Mock).mockResolvedValue([
      {
        id: 'q1', question: 'Which crop?', state: 'open', created_at: new Date('2026-11-11T10:00:00Z'), sent_at: null, answered_at: null,
        asked_by_user_id: 'bast-id', asked_by_lane: null, asked_of_contact: { name: 'Lisa', email: 'l@x.com' }, task: { id: 't1', title: 'Hero' },
      },
    ]);
    (prisma.meeting.findMany as Mock).mockResolvedValue([
      { id: 'm1', title: 'Review call', meeting_date: new Date('2026-11-09T15:00:00Z'), summary: null, created_by: { name: 'Mike' } },
    ]);
    (prisma.user.findMany as Mock).mockResolvedValue([{ id: 'bast-id', name: 'Bast' }]);
  });

  it('returns the combined timeline newest first with counts', async () => {
    const res = await GET(req(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { kind: string }) => i.kind)).toEqual(['question', 'email', 'meeting']);
    expect(body.items[0]).toMatchObject({ from: 'Bast', detail: 'Asked of Lisa, open', href: '/tasks/t1' });
    expect(body.counts).toEqual({ email: 1, question: 1, meeting: 1 });
  });

  it('reads emails filed to the project or its cards, questions on its non-triage cards, and meetings linked either way', async () => {
    await GET(req(), { params });
    expect(prisma.emailAsk.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ project_id: 'proj-1' }, { task: { project_id: 'proj-1', is_deleted: false } }] },
    }));
    expect(prisma.taskQuestion.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { state: { not: 'withdrawn' }, task: { project_id: 'proj-1', is_deleted: false, status: { not: 'triage' } } },
    }));
    expect(prisma.meeting.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        is_deleted: false,
        OR: [{ meeting_projects: { some: { project_id: 'proj-1' } } }, { tasks: { some: { project_id: 'proj-1', is_deleted: false } } }],
      },
    }));
  });

  it('is pm/admin only', async () => {
    (requireRole as Mock).mockImplementation(() => { throw new ApiError('Forbidden', 403); });
    const res = await GET(req(), { params });
    expect(res.status).toBe(403);
    expect(prisma.emailAsk.findMany).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing project', async () => {
    (prisma.project.findUnique as Mock).mockResolvedValue(null);
    const res = await GET(req(), { params });
    expect(res.status).toBe(404);
  });

  it('skips the user lookup when no question names an asker', async () => {
    (prisma.taskQuestion.findMany as Mock).mockResolvedValue([]);
    await GET(req(), { params });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
