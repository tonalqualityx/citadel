import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';
import { GET, POST } from '../route';

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
      findMany: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn(),
    },
    // Oracle Projects Phase 1 follow-up (verification) — the stale-mute recompute runs
    // inside a transaction; the mock invokes the callback with the SAME mocked prisma
    // client so tx.projectNote.create / tx.projectNote.aggregate / tx.project.update
    // assertions read through the plain top-level mocks above.
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/services/activity', () => ({
  logCreate: vi.fn(),
}));

// MEDIUM-2 — until_date is now resolved server-side, per-user timezone.
vi.mock('@/lib/services/user-timezone', () => ({
  resolveUserTimezone: vi.fn().mockResolvedValue('America/New_York'),
}));

import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { logCreate } from '@/lib/services/activity';
import { getDayBoundsForTimezone } from '@/lib/utils/time';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRequireRole = vi.mocked(requireRole);
const mockProjectFindUnique = prisma.project.findUnique as Mock;
const mockProjectUpdate = prisma.project.update as Mock;
const mockNoteFindMany = prisma.projectNote.findMany as Mock;
const mockNoteCreate = prisma.projectNote.create as Mock;
const mockNoteAggregate = prisma.projectNote.aggregate as Mock;
const mockTransaction = prisma.$transaction as Mock;
const mockLogCreate = logCreate as Mock;

const PROJECT_ID = 'project-1';

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    project_id: PROJECT_ID,
    user_id: 'user-1',
    user: { id: 'user-1', name: 'Mike' },
    kind: 'note',
    body: 'Called the client.',
    until_date: null,
    is_deleted: false,
    created_at: new Date('2026-09-04T00:00:00Z'),
    updated_at: new Date('2026-09-04T00:00:00Z'),
    ...overrides,
  };
}

function getReq(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/projects/${PROJECT_ID}/notes`);
}

function postReq(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/projects/${PROJECT_ID}/notes`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function ctx() {
  return { params: Promise.resolve({ id: PROJECT_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'pm', email: 'pm@example.com' });
  mockRequireRole.mockImplementation(() => {});
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID, name: 'Test Project' });
  // Default: no live parked_until notes at all -> recompute lands on null.
  mockNoteAggregate.mockResolvedValue({ _max: { until_date: null } });
  mockTransaction.mockImplementation(async (cb: (tx: typeof prisma) => unknown) => cb(prisma));
});

describe('GET /api/projects/[id]/notes', () => {
  it('requires PM/Admin role (H2 security fix)', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await GET(getReq(), ctx());
    expect(res.status).toBe(403);
  });

  it('lists non-deleted notes, newest first', async () => {
    mockNoteFindMany.mockResolvedValue([note(), note({ id: 'note-2' })]);

    const res = await GET(getReq(), ctx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    expect(mockNoteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project_id: PROJECT_ID, is_deleted: false },
        orderBy: { created_at: 'desc' },
      })
    );
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await GET(getReq(), ctx());
    expect(res.status).toBe(404);
  });
});

describe('POST /api/projects/[id]/notes', () => {
  it('creates a plain note and leaves the mute at null (no live parks)', async () => {
    mockNoteCreate.mockResolvedValue(note());

    const res = await POST(postReq({ body: 'Called the client.' }), ctx());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.kind).toBe('note');
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          project_id: PROJECT_ID,
          user_id: 'user-1',
          kind: 'note',
          body: 'Called the client.',
          until_date: null,
        }),
      })
    );
    // Recompute always runs, but with zero live parked_until notes it resolves to null —
    // a plain note never introduces one, so the aggregate is untouched by this create.
    expect(mockNoteAggregate).toHaveBeenCalledWith({
      where: { project_id: PROJECT_ID, kind: 'parked_until', is_deleted: false },
      _max: { until_date: true },
    });
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { stale_muted_until: null },
    });
    expect(mockLogCreate).toHaveBeenCalledWith('user-1', 'project_note', note().id, 'Test Project');
  });

  it('requires until_date when kind is parked_until', async () => {
    const res = await POST(postReq({ kind: 'parked_until', body: 'Snoozed' }), ctx());
    expect(res.status).toBe(400);
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });

  it('creating the first parked_until note sets Project.stale_muted_until to its date', async () => {
    // MEDIUM-2: the request carries a plain YYYY-MM-DD date; the route resolves it to
    // end-of-day in the requester's own timezone (mocked above as America/New_York).
    const untilDate = '2026-09-20';
    const expectedInstant = getDayBoundsForTimezone(untilDate, 'America/New_York').end;
    mockNoteCreate.mockResolvedValue(note({ kind: 'parked_until', until_date: expectedInstant }));
    mockNoteAggregate.mockResolvedValue({ _max: { until_date: expectedInstant } });

    const res = await POST(
      postReq({ kind: 'parked_until', body: 'Snoozed pending reply', until_date: untilDate }),
      ctx()
    );

    expect(res.status).toBe(201);
    expect(mockNoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ until_date: expectedInstant }) })
    );
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { stale_muted_until: expectedInstant },
    });
  });

  it('rejects an until_date that is not a plain YYYY-MM-DD string', async () => {
    const res = await POST(
      postReq({ kind: 'parked_until', body: 'Snoozed', until_date: '2026-09-20T00:00:00.000Z' }),
      ctx()
    );
    expect(res.status).toBe(400);
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });

  it('an earlier-dated new park does not move the mute backward, MAX still wins', async () => {
    // A later park is already live; this create adds an EARLIER one.
    const laterUntil = getDayBoundsForTimezone('2026-09-20', 'America/New_York').end;
    const earlierUntil = '2026-09-10';
    const earlierInstant = getDayBoundsForTimezone(earlierUntil, 'America/New_York').end;
    mockNoteCreate.mockResolvedValue(note({ kind: 'parked_until', until_date: earlierInstant }));
    // The aggregate reflects the DB state after this create: MAX is still the later date.
    mockNoteAggregate.mockResolvedValue({ _max: { until_date: laterUntil } });

    const res = await POST(
      postReq({ kind: 'parked_until', body: 'Snoozed again, earlier date', until_date: earlierUntil }),
      ctx()
    );

    expect(res.status).toBe(201);
    expect(mockProjectUpdate).toHaveBeenCalledWith({
      where: { id: PROJECT_ID },
      data: { stale_muted_until: laterUntil },
    });
  });

  // MEDIUM-2 acceptance test: picking 2026-10-04 (with TZ=America/New_York) reads back
  // as 10/4/2026, not 10/3, and the resulting mute instant covers every moment of that
  // calendar day in that zone — the two things the original UTC-midnight bug broke.
  it('picking 2026-10-04 in America/New_York resolves to an instant that reads back as 10/4/2026 and covers the whole local day', async () => {
    const untilInstant = getDayBoundsForTimezone('2026-10-04', 'America/New_York').end;
    mockNoteCreate.mockResolvedValue(note({ kind: 'parked_until', until_date: untilInstant }));
    mockNoteAggregate.mockResolvedValue({ _max: { until_date: untilInstant } });

    const res = await POST(
      postReq({ kind: 'parked_until', body: 'Snoozed pending reply', until_date: '2026-10-04' }),
      ctx()
    );
    expect(res.status).toBe(201);

    // What a browser sitting in America/New_York would render for this instant — the
    // same call NotesLog.tsx's toLocaleDateString() effectively performs for Mike, whose
    // browser IS in that zone.
    const renderedInNY = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    }).format(untilInstant);
    expect(renderedInNY).toBe('10/4/2026');

    // The mute (Project.stale_muted_until) is compared as `> now` (see
    // classifyStale in lib/oracle/projects/blockers.ts) — it must still be live at
    // 11pm ET on the 4th, and no longer live once the 5th begins, in that zone.
    const stillOct4Evening = new Date('2026-10-05T02:00:00.000Z'); // 10pm ET on the 4th
    const nowOct5 = new Date('2026-10-05T05:00:00.000Z'); // 1am ET on the 5th
    expect(untilInstant.getTime() > stillOct4Evening.getTime()).toBe(true);
    expect(untilInstant.getTime() > nowOct5.getTime()).toBe(false);
  });

  it('rejects an empty body', async () => {
    const res = await POST(postReq({ body: '' }), ctx());
    expect(res.status).toBe(400);
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });

  it('rejects a body over 10000 chars', async () => {
    const res = await POST(postReq({ body: 'a'.repeat(10001) }), ctx());
    expect(res.status).toBe(400);
    expect(mockNoteCreate).not.toHaveBeenCalled();
  });

  it('404s when the project does not exist', async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    const res = await POST(postReq({ body: 'Note' }), ctx());
    expect(res.status).toBe(404);
  });

  it('requires PM/Admin role', async () => {
    const { AuthError } = await import('@/lib/api/errors');
    mockRequireRole.mockImplementation(() => {
      throw new AuthError('Insufficient permissions', 403);
    });

    const res = await POST(postReq({ body: 'Note' }), ctx());
    expect(res.status).toBe(403);
  });
});
