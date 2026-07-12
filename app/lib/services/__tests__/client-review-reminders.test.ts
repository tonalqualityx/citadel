import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    article: { findMany: vi.fn() },
    clientContact: { findFirst: vi.fn() },
    client: { findUnique: vi.fn() },
    portalSession: { findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('@/lib/services/email', () => ({
  sendEmail: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/services/email';
import { sendClientReviewReminders } from '../client-review-reminders';
import type { Mock } from 'vitest';

const mockArticleFindMany = prisma.article.findMany as Mock;
const mockContactFindFirst = prisma.clientContact.findFirst as Mock;
const mockClientFindUnique = prisma.client.findUnique as Mock;
const mockPortalSessionFindFirst = prisma.portalSession.findFirst as Mock;
const mockPortalSessionCreate = prisma.portalSession.create as Mock;
const mockSendEmail = sendEmail as Mock;

const ARTICLE = { id: 'art-1', title: 'Q3 Recap', client_id: 'client-acme' };

const originalEnv = process.env.CLIENT_REVIEW_REMINDERS_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  mockArticleFindMany.mockResolvedValue([ARTICLE]);
  mockPortalSessionFindFirst.mockResolvedValue(null);
  mockContactFindFirst.mockResolvedValue({ email: 'contact@acme.com', name: 'Jane' });
  mockClientFindUnique.mockResolvedValue({ email: 'billing@acme.com', name: 'Acme Co' });
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.CLIENT_REVIEW_REMINDERS_ENABLED;
  else process.env.CLIENT_REVIEW_REMINDERS_ENABLED = originalEnv;
});

describe('sendClientReviewReminders — OFF by default', () => {
  it('sends nothing when the env var is unset', async () => {
    delete process.env.CLIENT_REVIEW_REMINDERS_ENABLED;

    const result = await sendClientReviewReminders(['art-1']);

    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(mockArticleFindMany).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when the env var is any value other than the literal string "true"', async () => {
    process.env.CLIENT_REVIEW_REMINDERS_ENABLED = '1';

    const result = await sendClientReviewReminders(['art-1']);

    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('no-ops on an empty id list even when enabled', async () => {
    process.env.CLIENT_REVIEW_REMINDERS_ENABLED = 'true';

    const result = await sendClientReviewReminders([]);

    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(mockArticleFindMany).not.toHaveBeenCalled();
  });
});

describe('sendClientReviewReminders — ON', () => {
  beforeEach(() => {
    process.env.CLIENT_REVIEW_REMINDERS_ENABLED = 'true';
  });

  it('sends to the client primary contact and records a throttle row', async () => {
    const result = await sendClientReviewReminders(['art-1']);

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.to).toBe('contact@acme.com');
    expect(sent.subject).toContain('Q3 Recap');
    expect(sent.html).toContain('/portal/login');

    expect(mockPortalSessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        token_type: 'review_reminder',
        entity_id: 'art-1',
      }),
    });
  });

  it('falls back to the Client email when there is no primary contact', async () => {
    mockContactFindFirst.mockResolvedValue(null);

    const result = await sendClientReviewReminders(['art-1']);

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(mockSendEmail.mock.calls[0][0].to).toBe('billing@acme.com');
  });

  it('skips (no send) when there is no contact and no client email', async () => {
    mockContactFindFirst.mockResolvedValue(null);
    mockClientFindUnique.mockResolvedValue({ email: null, name: 'Acme Co' });

    const result = await sendClientReviewReminders(['art-1']);

    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('skips (throttled) when a reminder was already sent within the window', async () => {
    mockPortalSessionFindFirst.mockResolvedValue({ id: 'prior-reminder' });

    const result = await sendClientReviewReminders(['art-1']);

    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockPortalSessionCreate).not.toHaveBeenCalled();
  });

  it('sends again once the throttle window has passed (no recent reminder row)', async () => {
    mockPortalSessionFindFirst.mockResolvedValue(null); // nothing within the window

    const result = await sendClientReviewReminders(['art-1']);

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('continues past a per-article failure without throwing', async () => {
    mockArticleFindMany.mockResolvedValue([
      ARTICLE,
      { id: 'art-2', title: 'Second one', client_id: 'client-other' },
    ]);
    mockSendEmail.mockRejectedValueOnce(new Error('smtp down')).mockResolvedValueOnce(undefined);

    const result = await sendClientReviewReminders(['art-1', 'art-2']);

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
