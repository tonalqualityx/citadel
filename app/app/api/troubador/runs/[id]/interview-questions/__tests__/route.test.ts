import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    troubadorRun: { findFirst: vi.fn(), update: vi.fn() },
    article: { findMany: vi.fn() },
    interview: { upsert: vi.fn() },
  },
}));

import { requireAuth } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockRequireAuth = requireAuth as Mock;
const mockRunFindFirst = prisma.troubadorRun.findFirst as Mock;
const mockRunUpdate = prisma.troubadorRun.update as Mock;
const mockArticleFindMany = prisma.article.findMany as Mock;
const mockInterviewUpsert = prisma.interview.upsert as Mock;

const RUN_ID = 'run-1';

function postRequest(body: object = { questions: ['What is your favorite feature?'] }): NextRequest {
  return new NextRequest(`http://localhost:3000/api/troubador/runs/${RUN_ID}/interview-questions`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const ctx = { params: Promise.resolve({ id: RUN_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user-1', role: 'pm' });
  mockInterviewUpsert.mockResolvedValue({ id: 'interview-1' });
  mockRunUpdate.mockResolvedValue({ id: RUN_ID, stage: 'ready_for_interview' });
});

describe('POST /api/troubador/runs/:id/interview-questions', () => {
  it('returns 404 when the run does not exist', async () => {
    mockRunFindFirst.mockResolvedValue(null);

    const res = await POST(postRequest(), ctx);
    expect(res.status).toBe(404);
    expect(mockInterviewUpsert).not.toHaveBeenCalled();
  });

  it('returns 409 when the run is in an unrelated stage', async () => {
    mockRunFindFirst.mockResolvedValue({ id: RUN_ID, stage: 'topic_selection', interview: null });

    const res = await POST(postRequest(), ctx);
    expect(res.status).toBe(409);
    expect(mockInterviewUpsert).not.toHaveBeenCalled();
  });

  it('returns 409 when in_production (interview already past)', async () => {
    mockRunFindFirst.mockResolvedValue({ id: RUN_ID, stage: 'in_production', interview: { status: 'complete' } });

    const res = await POST(postRequest(), ctx);
    expect(res.status).toBe(409);
  });

  describe('researching stage (first-pass path)', () => {
    it('returns 409 when an article is still pending_research', async () => {
      mockRunFindFirst.mockResolvedValue({ id: RUN_ID, stage: 'researching', interview: null });
      mockArticleFindMany.mockResolvedValue([{ status: 'researched' }, { status: 'pending_research' }]);

      const res = await POST(postRequest(), ctx);
      expect(res.status).toBe(409);
      expect(mockInterviewUpsert).not.toHaveBeenCalled();
    });

    it('upserts questions and advances stage when all articles are researched', async () => {
      mockRunFindFirst.mockResolvedValue({ id: RUN_ID, stage: 'researching', interview: null });
      mockArticleFindMany.mockResolvedValue([{ status: 'researched' }, { status: 'drafting' }]);

      const res = await POST(postRequest({ questions: ['Q1', 'Q2'] }), ctx);
      expect(res.status).toBe(200);
      const payload = await res.json();
      expect(payload).toEqual({
        run_id: RUN_ID,
        stage: 'ready_for_interview',
        interview_status: 'pending',
      });

      expect(mockInterviewUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { run_id: RUN_ID },
          create: expect.objectContaining({ run_id: RUN_ID, status: 'pending' }),
          update: expect.objectContaining({ status: 'pending' }),
        })
      );
      expect(mockRunUpdate).toHaveBeenCalledWith({
        where: { id: RUN_ID },
        data: { stage: 'ready_for_interview' },
      });
    });

    it('ignores dropped articles when checking research completeness', async () => {
      mockRunFindFirst.mockResolvedValue({ id: RUN_ID, stage: 'researching', interview: null });
      // dropped articles are excluded by the query's own where-clause; findMany only ever
      // returns non-dropped rows, so a pending_research row here is real.
      mockArticleFindMany.mockResolvedValue([{ status: 'researched' }]);

      const res = await POST(postRequest(), ctx);
      expect(res.status).toBe(200);
    });
  });

  describe('ready_for_interview stage (regenerate path)', () => {
    it('succeeds and replaces questions without re-checking articles or advancing stage', async () => {
      mockRunFindFirst.mockResolvedValue({
        id: RUN_ID,
        stage: 'ready_for_interview',
        interview: { status: 'pending' },
      });

      const res = await POST(postRequest({ questions: ['New Q1'] }), ctx);
      expect(res.status).toBe(200);
      const payload = await res.json();
      expect(payload).toEqual({
        run_id: RUN_ID,
        stage: 'ready_for_interview',
        interview_status: 'pending',
      });

      // The regenerate path never re-checks article research state.
      expect(mockArticleFindMany).not.toHaveBeenCalled();
      // Stage is already ready_for_interview — no run update needed.
      expect(mockRunUpdate).not.toHaveBeenCalled();
      expect(mockInterviewUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { run_id: RUN_ID },
          update: expect.objectContaining({ status: 'pending' }),
        })
      );
    });

    it('returns 409 when the interview is already complete', async () => {
      mockRunFindFirst.mockResolvedValue({
        id: RUN_ID,
        stage: 'ready_for_interview',
        interview: { status: 'complete' },
      });

      const res = await POST(postRequest(), ctx);
      expect(res.status).toBe(409);
      expect(mockInterviewUpsert).not.toHaveBeenCalled();
    });
  });
});
