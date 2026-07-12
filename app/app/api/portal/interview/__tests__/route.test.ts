import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    troubadorRun: { findMany: vi.fn() },
  },
}));

import { GET } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireClientAuth = requireClientAuth as Mock;
const mockRunFindMany = prisma.troubadorRun.findMany as Mock;

function makeRequest(): NextRequest {
  return new NextRequest(new URL('http://localhost/api/portal/interview'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/portal/interview', () => {
  it('returns 401 when there is no client session', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockRunFindMany).not.toHaveBeenCalled();
  });

  it('returns an empty list when nothing is pending', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toEqual({ interviews: [] });

    // Scope is implicit (client_id from session), stage filtered at the query level.
    const where = mockRunFindMany.mock.calls[0][0].where;
    expect(where).toEqual({ client_id: 'client-acme', is_deleted: false, stage: 'ready_for_interview' });
  });

  it('excludes a run whose interview is already complete', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindMany.mockResolvedValue([
      {
        id: 'run-1',
        title: 'Q3 Content Run',
        interview: { status: 'complete', questions: ['Q1'], answers: null },
      },
    ]);

    const res = await GET(makeRequest());
    const payload = await res.json();
    expect(payload.interviews).toEqual([]);
  });

  it('excludes a run whose interview has no questions yet', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindMany.mockResolvedValue([
      { id: 'run-1', title: 'Q3 Content Run', interview: { status: 'pending', questions: null, answers: null } },
    ]);

    const res = await GET(makeRequest());
    const payload = await res.json();
    expect(payload.interviews).toEqual([]);
  });

  it('excludes a run with no interview row at all', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindMany.mockResolvedValue([{ id: 'run-1', title: 'Q3 Content Run', interview: null }]);

    const res = await GET(makeRequest());
    const payload = await res.json();
    expect(payload.interviews).toEqual([]);
  });

  it('returns pending interviews with only the caller\'s own answers', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindMany.mockResolvedValue([
      {
        id: 'run-1',
        title: 'Q3 Content Run',
        interview: {
          status: 'pending',
          questions: ['What is your biggest challenge?'],
          answers: [
            { question_index: 0, question: null, answer: 'Mine', answered_at: '2026-07-01T00:00:00Z', contact_id: 'contact-1' },
            { question_index: 0, question: null, answer: 'Theirs', answered_at: '2026-07-01T00:00:00Z', contact_id: 'contact-9' },
          ],
        },
      },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.interviews).toEqual([
      {
        run_id: 'run-1',
        run_title: 'Q3 Content Run',
        questions: ['What is your biggest challenge?'],
        answers: [
          { question_index: 0, question: null, answer: 'Mine', answered_at: '2026-07-01T00:00:00Z', contact_id: 'contact-1' },
        ],
        interview_status: 'pending',
      },
    ]);
  });
});
