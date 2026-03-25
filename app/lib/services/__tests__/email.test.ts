import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    integration: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { sendEmail, sendPasswordResetEmail } from '../email';
import { prisma } from '@/lib/db/prisma';
import type { Mock } from 'vitest';

const mockIntegrationFindUnique = prisma.integration.findUnique as Mock;

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

  it('falls back to console when SendGrid not configured', async () => {
    mockIntegrationFindUnique.mockResolvedValue(null);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail(defaultEmailOptions);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('To: recipient@test.com'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Subject'));

    consoleSpy.mockRestore();
  });

  it('falls back to console when SendGrid integration is inactive', async () => {
    mockIntegrationFindUnique.mockResolvedValue({
      ...validSendGridIntegration,
      is_active: false,
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendEmail(defaultEmailOptions);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('To: recipient@test.com'));

    consoleSpy.mockRestore();
  });

  it('falls back to console when SendGrid API fails', async () => {
    mockIntegrationFindUnique.mockResolvedValue(validSendGridIntegration);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await sendEmail(defaultEmailOptions);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'SendGrid failed, falling back to console logging'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('To: recipient@test.com'));

    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('falls back to console when fetch throws', async () => {
    mockIntegrationFindUnique.mockResolvedValue(validSendGridIntegration);
    mockFetch.mockRejectedValue(new Error('Network error'));
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await sendEmail(defaultEmailOptions);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('To: recipient@test.com'));

    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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
