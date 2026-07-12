import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/api/errors';

vi.mock('@/lib/services/client-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/client-auth')>();
  return { ...actual, requireClientAuth: vi.fn() };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    troubadorRun: { findFirst: vi.fn() },
    interview: { update: vi.fn() },
  },
}));

vi.mock('@/lib/services/notifications', () => ({
  createNotification: vi.fn(() => Promise.resolve(null)),
}));

import { POST } from '../route';
import { requireClientAuth } from '@/lib/services/client-auth';
import { prisma } from '@/lib/db/prisma';
import { createNotification } from '@/lib/services/notifications';
import type { Mock } from 'vitest';

const mockRequireClientAuth = requireClientAuth as Mock;
const mockRunFindFirst = prisma.troubadorRun.findFirst as Mock;
const mockInterviewUpdate = prisma.interview.update as Mock;
const mockCreateNotification = createNotification as Mock;

const RUN_ID = 'run-1';

function postRequest(body: object): NextRequest {
  return new NextRequest(`http://localhost:3000/api/portal/interview/${RUN_ID}/answers`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeParams(runId = RUN_ID) {
  return { params: Promise.resolve({ runId }) };
}

const baseRun = {
  id: RUN_ID,
  title: 'Q3 Content Run',
  stage: 'ready_for_interview',
  client_id: 'client-acme',
  assignee_id: 'user-editor',
  client: { name: 'Acme Co' },
  interview: { id: 'interview-1', status: 'pending', answers: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInterviewUpdate.mockResolvedValue({});
});

describe('POST /api/portal/interview/:runId/answers', () => {
  it('returns 401 when there is no client session', async () => {
    mockRequireClientAuth.mockRejectedValue(new AuthError('Client authentication required', 401));

    const res = await POST(postRequest({ answers: [{ question_index: 0, answer: 'Hi' }] }), makeParams());
    expect(res.status).toBe(401);
    expect(mockRunFindFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when the run does not exist', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindFirst.mockResolvedValue(null);

    const res = await POST(postRequest({ answers: [{ question_index: 0, answer: 'Hi' }] }), makeParams());
    expect(res.status).toBe(404);
  });

  it('returns 403 when the run belongs to another client', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-other', contactId: 'contact-9' });
    mockRunFindFirst.mockResolvedValue(baseRun);

    const res = await POST(postRequest({ answers: [{ question_index: 0, answer: 'Hi' }] }), makeParams());
    expect(res.status).toBe(403);
    expect(mockInterviewUpdate).not.toHaveBeenCalled();
  });

  it('returns 409 when the run is not in ready_for_interview', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindFirst.mockResolvedValue({ ...baseRun, stage: 'in_production' });

    const res = await POST(postRequest({ answers: [{ question_index: 0, answer: 'Hi' }] }), makeParams());
    expect(res.status).toBe(409);
  });

  it('returns 409 when the interview is already complete', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindFirst.mockResolvedValue({ ...baseRun, interview: { id: 'interview-1', status: 'complete', answers: null } });

    const res = await POST(postRequest({ answers: [{ question_index: 0, answer: 'Hi' }] }), makeParams());
    expect(res.status).toBe(409);
  });

  it('returns 409 when there is no interview row at all', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindFirst.mockResolvedValue({ ...baseRun, interview: null });

    const res = await POST(postRequest({ answers: [{ question_index: 0, answer: 'Hi' }] }), makeParams());
    expect(res.status).toBe(409);
  });

  it('returns 400 when an answer has neither question_index nor question', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindFirst.mockResolvedValue(baseRun);

    const res = await POST(postRequest({ answers: [{ answer: 'Hi' }] }), makeParams());
    expect(res.status).toBe(400);
    expect(mockInterviewUpdate).not.toHaveBeenCalled();
  });

  it('merges new answers, stamps contact_id/answered_at, preserves other entries, does not touch status/stage', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindFirst.mockResolvedValue({
      ...baseRun,
      interview: {
        id: 'interview-1',
        status: 'pending',
        answers: [
          { question_index: 0, question: null, answer: 'Old answer 0', answered_at: '2026-06-01T00:00:00Z', contact_id: 'contact-1' },
          { question_index: 1, question: null, answer: 'Other contact answer', answered_at: '2026-06-01T00:00:00Z', contact_id: 'contact-9' },
        ],
      },
    });

    const res = await POST(
      postRequest({ answers: [{ question_index: 0, answer: 'Updated answer 0' }, { question_index: 2, answer: 'New answer 2' }] }),
      makeParams()
    );
    expect(res.status).toBe(200);
    const payload = await res.json();

    // Response only includes the caller's own answers (contact-9's is not echoed back).
    expect(payload.run_id).toBe(RUN_ID);
    expect(payload.answers).toHaveLength(2);
    expect(payload.answers.find((a: { question_index: number }) => a.question_index === 0)).toMatchObject({
      answer: 'Updated answer 0',
      contact_id: 'contact-1',
    });
    expect(payload.answers.find((a: { question_index: number }) => a.question_index === 2)).toMatchObject({
      answer: 'New answer 2',
      contact_id: 'contact-1',
    });

    // The persisted array preserves the other contact's untouched entry.
    const savedAnswers = mockInterviewUpdate.mock.calls[0][0].data.answers;
    expect(savedAnswers).toHaveLength(3);
    const otherContactEntry = savedAnswers.find((a: { contact_id: string }) => a.contact_id === 'contact-9');
    expect(otherContactEntry).toMatchObject({ question_index: 1, answer: 'Other contact answer' });

    // Only Interview.answers is written — no status/stage field in the update call.
    expect(mockInterviewUpdate).toHaveBeenCalledWith({
      where: { id: 'interview-1' },
      data: { answers: savedAnswers },
    });
  });

  it('notifies the run assignee with the expected type/priority/title', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindFirst.mockResolvedValue(baseRun);

    await POST(postRequest({ answers: [{ question_index: 0, answer: 'Hi' }] }), makeParams());

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-editor',
        type: 'interview_answers_submitted',
        title: 'Interview answers from Acme Co: Q3 Content Run',
        priority: 'high',
      })
    );
  });

  it('skips the notification when the run has no assignee', async () => {
    mockRequireClientAuth.mockResolvedValue({ clientId: 'client-acme', contactId: 'contact-1' });
    mockRunFindFirst.mockResolvedValue({ ...baseRun, assignee_id: null });

    const res = await POST(postRequest({ answers: [{ question_index: 0, answer: 'Hi' }] }), makeParams());
    expect(res.status).toBe(200);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
