import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { DELETE } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    projectNote: {
      findUnique: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    // Oracle Projects Phase 1 follow-up (verification) — the stale-mute recompute runs
    // inside a transaction; the mock invokes the callback with the SAME mocked prisma
    // client so assertions on prisma.projectNote.update / prisma.project.update read
    // through cleanly.
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logDelete: vi.fn(),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logDelete } from '@/lib/services/activity';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockProjectUpdate = prisma.project.update as Mock;
const mockNoteFindUnique = prisma.projectNote.findUnique as Mock;
const mockNoteUpdate = prisma.projectNote.update as Mock;
const mockNoteAggregate = prisma.projectNote.aggregate as Mock;
const mockTransaction = prisma.$transaction as Mock;
const mockLogDelete = logDelete as Mock;

const PROJECT_ID = 'project-1';
const NOTE_ID = 'note-1';
const UNTIL = new Date('2026-09-20T00:00:00.000Z');

function req(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/projects/${PROJECT_ID}/notes/${NOTE_ID}`, {
    method: 'DELETE',
  });
}

function ctx() {
  return { params: Promise.resolve({ id: PROJECT_ID, noteId: NOTE_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'pm', email: 'pm@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Test Project' });
  mockTransaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
});

describe('DELETE /api/projects/[id]/notes/[noteId]', () => {
  it('soft deletes a plain note; recompute finds no live parks, mute stays null', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'note',
      until_date: null,
      is_deleted: false,
    });
    mockNoteAggregate.mockResolvedValue({ _max: { until_date: null } });

    const res = await DELETE(req(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockNoteUpdate).toHaveBeenCalledWith({
      where: { id: NOTE_ID },
      data: { is_deleted: true },
    });
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { stale_muted_until: null },
    });
    expect(mockLogDelete).toHaveBeenCalledWith('user-1', 'project_note', NOTE_ID, 'Test Project');
  });

  it('two parked notes share a date; deleting one leaves the mute UNCHANGED (the other still carries it)', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'parked_until',
      until_date: UNTIL,
      is_deleted: false,
    });
    // The surviving parked_until note shares the same until_date -> MAX is unchanged.
    mockNoteAggregate.mockResolvedValue({ _max: { until_date: UNTIL } });

    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(200);
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { stale_muted_until: UNTIL },
    });
  });

  it('deleting the LAST live parked_until note clears Project.stale_muted_until to null', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'parked_until',
      until_date: UNTIL,
      is_deleted: false,
    });
    mockNoteAggregate.mockResolvedValue({ _max: { until_date: null } });

    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(200);
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { stale_muted_until: null },
    });
  });

  it('an OLDER live park falls back correctly after the newest one is deleted', async () => {
    const olderUntil = new Date('2026-09-10T00:00:00.000Z');
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'parked_until',
      until_date: UNTIL,
      is_deleted: false,
    });
    // With the newest park (UNTIL) deleted, the older still-live park drives the mute.
    mockNoteAggregate.mockResolvedValue({ _max: { until_date: olderUntil } });

    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(200);
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { stale_muted_until: olderUntil },
    });
  });

  it('404s when the note does not exist', async () => {
    mockNoteFindUnique.mockResolvedValue(null);
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(404);
    expect(mockNoteUpdate).not.toHaveBeenCalled();
  });

  it('404s when the note belongs to a different project', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: 'some-other-project',
      kind: 'note',
      until_date: null,
      is_deleted: false,
    });
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('404s when the note is already deleted', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'note',
      until_date: null,
      is_deleted: true,
    });
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('404s when the project does not exist', async () => {
    mockNoteFindUnique.mockResolvedValue({
      id: NOTE_ID,
      project_id: PROJECT_ID,
      kind: 'note',
      until_date: null,
      is_deleted: false,
    });
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(404);
    expect(mockNoteUpdate).not.toHaveBeenCalled();
  });

  it('requires PM/Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await DELETE(req(), ctx());
    expect(res.status).toBe(403);
  });
});
