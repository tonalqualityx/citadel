import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    integration: {
      findUnique: vi.fn(),
    },
    emailOutbox: {
      create: vi.fn(),
    },
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { sendEmail, sendPasswordResetEmail, sendTaskApprovalRequestEmail, redactLoginLinks } from '../email';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockIntegrationFindUnique = prisma.integration.findUnique as Mock;
const mockOutboxCreate = prisma.emailOutbox.create as Mock;

const validSendGridIntegration = {
  id: 'int-1',
  provider: 'sendgrid',
  is_active: true,
  config: {
    apiKey: 'SG.test-api-key',
    fromEmail: 'noreply@example.com',
  },
};

const defaultEmailOptions = {
  to: 'recipient@test.com',
  subject: 'Test Subject',
  text: 'Test body content',
  govern: { intent: 'none' as const, reason: 'test' },
};

describe('sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends via SendGrid when configured', async () => {
    mockIntegrationFindUnique.mockResolvedValue(validSendGridIntegration);
    mockFetch.mockResolvedValue({ ok: true });

    await sendEmail(defaultEmailOptions);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer SG.test-api-key');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body);
    expect(body.personalizations[0].to[0].email).toBe('recipient@test.com');
    expect(body.personalizations[0].subject).toBe('Test Subject');
    expect(body.from.email).toBe('noreply@example.com');
    expect(body.from.name).toBe('Indelible');
    expect(body.content).toEqual([
      { type: 'text/plain', value: 'Test body content' },
    ]);
  });

  it('queues in the outbox when SendGrid is not configured', async () => {
    mockIntegrationFindUnique.mockResolvedValue(null);
    mockOutboxCreate.mockResolvedValue({ id: 'o1' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail({ ...defaultEmailOptions, html: '<p>hi</p>', kind: 'magic_link', dedupeKey: 'magic:abc', allowExternal: true });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockOutboxCreate.mock.calls[0][0].data).toMatchObject({
      to: 'recipient@test.com',
      subject: 'Test Subject',
      text: 'Test body content',
      html: '<p>hi</p>',
      kind: 'magic_link',
      allow_external: true,
      dedupe_key: 'magic:abc',
      govern: { intent: 'none', reason: 'test' },
    });
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Test body content'));
    logSpy.mockRestore();
  });

  it('defaults to kind other, no external allowance, no dedupe key', async () => {
    mockIntegrationFindUnique.mockResolvedValue({ ...validSendGridIntegration, is_active: false });
    mockOutboxCreate.mockResolvedValue({ id: 'o1' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail(defaultEmailOptions);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockOutboxCreate.mock.calls[0][0].data).toMatchObject({ kind: 'other', allow_external: false, dedupe_key: null, html: null });
    logSpy.mockRestore();
  });

  it('queues in the outbox when the SendGrid API fails', async () => {
    mockIntegrationFindUnique.mockResolvedValue(validSendGridIntegration);
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('Internal Server Error') });
    mockOutboxCreate.mockResolvedValue({ id: 'o1' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await sendEmail(defaultEmailOptions);

    expect(warnSpy).toHaveBeenCalledWith('SendGrid failed, queueing in outbox');
    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('queues in the outbox when fetch throws', async () => {
    mockIntegrationFindUnique.mockResolvedValue(validSendGridIntegration);
    mockFetch.mockRejectedValue(new Error('Network error'));
    mockOutboxCreate.mockResolvedValue({ id: 'o1' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await sendEmail(defaultEmailOptions);

    expect(mockOutboxCreate).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('treats a duplicate dedupe key as already queued (no console fallback)', async () => {
    mockIntegrationFindUnique.mockResolvedValue(null);
    mockOutboxCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail({ ...defaultEmailOptions, dedupeKey: 'magic:abc' });

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('EMAIL SERVICE'));
    logSpy.mockRestore();
  });

  it('falls back to console when the outbox write itself fails', async () => {
    mockIntegrationFindUnique.mockResolvedValue(null);
    mockOutboxCreate.mockRejectedValue(new Error('db down'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await sendEmail(defaultEmailOptions);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('To: recipient@test.com'));
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('logs to the console and skips the outbox in development', async () => {
    mockIntegrationFindUnique.mockResolvedValue(null);
    vi.stubEnv('NODE_ENV', 'development');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail(defaultEmailOptions);

    expect(mockOutboxCreate).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('To: recipient@test.com'));
    logSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('includes HTML content when provided', async () => {
    mockIntegrationFindUnique.mockResolvedValue(validSendGridIntegration);
    mockFetch.mockResolvedValue({ ok: true });

    await sendEmail({
      ...defaultEmailOptions,
      html: '<p>HTML body</p>',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content).toEqual([
      { type: 'text/plain', value: 'Test body content' },
      { type: 'text/html', value: '<p>HTML body</p>' },
    ]);
  });
});

describe('sendPasswordResetEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it('sends password reset email with correct template', async () => {
    mockIntegrationFindUnique.mockResolvedValue(validSendGridIntegration);
    mockFetch.mockResolvedValue({ ok: true });

    await sendPasswordResetEmail('user@test.com', 'token-abc', 'John');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);

    expect(body.personalizations[0].to[0].email).toBe('user@test.com');
    expect(body.personalizations[0].subject).toBe('Reset your Indelible password');

    const textContent = body.content.find((c: { type: string }) => c.type === 'text/plain');
    expect(textContent.value).toContain('Hi John');
    expect(textContent.value).toContain('token-abc');
    expect(textContent.value).toContain('/reset-password?token=token-abc');

    const htmlContent = body.content.find((c: { type: string }) => c.type === 'text/html');
    expect(htmlContent.value).toContain('Hi John');
    expect(htmlContent.value).toContain('/reset-password?token=token-abc');
  });

  it('works without userName', async () => {
    mockIntegrationFindUnique.mockResolvedValue(validSendGridIntegration);
    mockFetch.mockResolvedValue({ ok: true });

    await sendPasswordResetEmail('user@test.com', 'token-xyz');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);

    const textContent = body.content.find((c: { type: string }) => c.type === 'text/plain');
    expect(textContent.value).toContain('Hi,');
    expect(textContent.value).not.toContain('Hi ,');
    expect(textContent.value).toContain('/reset-password?token=token-xyz');
  });
});

describe('sendTaskApprovalRequestEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIntegrationFindUnique.mockResolvedValue(validSendGridIntegration);
    mockFetch.mockResolvedValue({ ok: true });
  });

  const baseOpts = {
    to: 'client@acme.com',
    approvalUrl: 'https://citadel.becomeindelible.com/portal/task-approval/tok123',
    taskTitle: 'Homepage hero update',
    contactName: 'Jane',
    stagingUrl: 'https://staging.acme.com/preview',
    taskId: '11111111-1111-4111-8111-111111111111',
  };

  it('includes both the preview link and the approval link', async () => {
    await sendTaskApprovalRequestEmail(baseOpts);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.personalizations[0].to[0].email).toBe('client@acme.com');
    expect(body.personalizations[0].subject).toContain('Homepage hero update');

    const text = body.content.find((c: { type: string }) => c.type === 'text/plain').value;
    const html = body.content.find((c: { type: string }) => c.type === 'text/html').value;

    expect(text).toContain(baseOpts.approvalUrl);
    expect(text).toContain(baseOpts.stagingUrl);
    expect(text).toContain('Hi Jane');
    expect(html).toContain(baseOpts.approvalUrl);
    expect(html).toContain(baseOpts.stagingUrl);
  });

  it('never reveals the internal worker persona', async () => {
    await sendTaskApprovalRequestEmail(baseOpts);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const text = body.content.find((c: { type: string }) => c.type === 'text/plain').value;
    const html = body.content.find((c: { type: string }) => c.type === 'text/html').value;

    expect(text.toLowerCase()).not.toContain('bast');
    expect(html.toLowerCase()).not.toContain('bast');
    expect(text).toContain('The Indelible Team');
  });

  it('omits the preview block when there is no staging URL', async () => {
    await sendTaskApprovalRequestEmail({ ...baseOpts, stagingUrl: null });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const text = body.content.find((c: { type: string }) => c.type === 'text/plain').value;

    expect(text).not.toContain('preview the work here');
    expect(text).toContain(baseOpts.approvalUrl);
  });

  it('handles a missing contact name without a dangling space', async () => {
    await sendTaskApprovalRequestEmail({ ...baseOpts, contactName: null });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const text = body.content.find((c: { type: string }) => c.type === 'text/plain').value;

    expect(text).toContain('Hi,');
    expect(text).not.toContain('Hi ,');
  });
});

describe('redactLoginLinks', () => {
  const body = 'Sign in: https://app.example.com/portal/login/verify#token=abc123 thanks';

  it('redacts portal login URLs in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const out = redactLoginLinks(body);
    expect(out).not.toContain('abc123');
    expect(out).toContain('[login link redacted]');
    vi.unstubAllEnvs();
  });

  it('leaves the text alone outside production (local dev needs the link)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(redactLoginLinks(body)).toBe(body);
    vi.unstubAllEnvs();
  });
});
