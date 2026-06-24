import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthError } from '@/lib/api/errors';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientContact: { findMany: vi.fn(), findUnique: vi.fn() },
    portalSession: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock('@/lib/services/email', () => ({
  sendClientMagicLinkEmail: vi.fn(),
}));

import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { sendClientMagicLinkEmail } from '@/lib/services/email';
import {
  requestClientMagicLink,
  createContactPortalLoginLink,
  consumeClientMagicLink,
  validateClientSession,
  requireClientAuth,
  assertClientScope,
  CLIENT_SESSION_COOKIE,
} from '../client-auth';
import type { Mock } from 'vitest';

const mockCookies = cookies as Mock;
const mockFindManyContacts = prisma.clientContact.findMany as Mock;
const mockFindUniqueContact = prisma.clientContact.findUnique as Mock;
const mockCreate = prisma.portalSession.create as Mock;
const mockFindFirst = prisma.portalSession.findFirst as Mock;
const mockSendEmail = sendClientMagicLinkEmail as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

const reqInput = { ipAddress: '1.2.3.4', userAgent: 'test-agent' };

describe('requestClientMagicLink', () => {
  it('issues a magic link and emails each matching active contact', async () => {
    mockFindManyContacts.mockResolvedValue([
      { id: 'contact-1', name: 'Ann', email: 'ann@acme.com', client_id: 'client-acme' },
      { id: 'contact-2', name: 'Ann (Agency)', email: 'ann@acme.com', client_id: 'client-agency' },
    ]);
    mockCreate.mockResolvedValue({});

    const count = await requestClientMagicLink({ email: 'ann@acme.com', ...reqInput });

    expect(count).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    // Each row is scoped to its own client and carries a magic_token.
    const created = mockCreate.mock.calls.map((c) => c[0].data);
    expect(created[0]).toMatchObject({ token_type: 'client_session', entity_id: 'client-acme', contact_id: 'contact-1' });
    expect(created[0].magic_token).toEqual(expect.any(String));
    expect(created[1]).toMatchObject({ entity_id: 'client-agency', contact_id: 'contact-2' });
    // Each email links to that row's own token.
    expect(created[0].magic_token).not.toEqual(created[1].magic_token);
    // Self-service links are now valid for ~7 days (reusable, team-shareable), not 15 minutes.
    const ttlMs = created[0].magic_token_expires_at.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    // The email advertises the 7-day window, not a minutes-based expiry.
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ expiresLabel: '7 days' });
  });

  it('does nothing (and sends no email) when no contact matches — no enumeration signal', async () => {
    mockFindManyContacts.mockResolvedValue([]);

    const count = await requestClientMagicLink({ email: 'nobody@nowhere.com', ...reqInput });

    expect(count).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('createContactPortalLoginLink', () => {
  const contact = {
    id: 'contact-1',
    name: 'Ann',
    email: 'ann@acme.com',
    client_id: 'client-acme',
    is_deleted: false,
  };

  it('mints a client-scoped invite link and returns the URL without emailing (copy)', async () => {
    mockFindUniqueContact.mockResolvedValue(contact);
    mockCreate.mockResolvedValue({});

    const result = await createContactPortalLoginLink({
      contactId: 'contact-1',
      send: false,
      ...reqInput,
    });

    expect(result).not.toBeNull();
    expect(result!.sent).toBe(false);
    expect(result!.contact).toMatchObject({ id: 'contact-1', email: 'ann@acme.com', clientId: 'client-acme' });
    expect(result!.url).toContain('/api/portal/login/');
    expect(mockSendEmail).not.toHaveBeenCalled();

    const created = mockCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({
      token_type: 'client_session',
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      action: 'invite',
    });
    expect(created.magic_token).toEqual(expect.any(String));
    // The returned URL embeds the row's own token.
    expect(result!.url).toContain(created.magic_token);
    // Team-invite TTL is the 7-day window (reusable, scoped to the contact's client).
    expect(created.magic_token_expires_at.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000);
  });

  it('emails the contact their link when send=true', async () => {
    mockFindUniqueContact.mockResolvedValue(contact);
    mockCreate.mockResolvedValue({});

    const result = await createContactPortalLoginLink({
      contactId: 'contact-1',
      send: true,
      ...reqInput,
    });

    expect(result!.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ to: 'ann@acme.com', loginUrl: result!.url });
  });

  it('returns null for an unknown or deleted contact (and never emails)', async () => {
    mockFindUniqueContact.mockResolvedValue(null);
    expect(await createContactPortalLoginLink({ contactId: 'nope', send: true, ...reqInput })).toBeNull();

    mockFindUniqueContact.mockResolvedValue({ ...contact, is_deleted: true });
    expect(await createContactPortalLoginLink({ contactId: 'contact-1', send: true, ...reqInput })).toBeNull();

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('consumeClientMagicLink', () => {
  const linkRow = {
    id: 'link-1',
    entity_id: 'client-acme',
    contact_id: 'contact-1',
    magic_token_expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
  };

  it('issues a ~7-day session by minting a NEW session row (link is never consumed)', async () => {
    mockFindFirst.mockResolvedValue(linkRow);
    mockCreate.mockResolvedValue({});

    const result = await consumeClientMagicLink({ magicToken: 'magic-abc', ...reqInput });

    expect(result).not.toBeNull();
    expect(result!.clientId).toBe('client-acme');
    expect(result!.contactId).toBe('contact-1');
    expect(result!.sessionToken).toEqual(expect.any(String));
    // ~7 days out (allow a minute of slack).
    const ms = result!.expiresAt.getTime() - Date.now();
    expect(ms).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 60_000);
    expect(ms).toBeLessThan(7 * 24 * 60 * 60 * 1000 + 60_000);
    // The link lookup is NOT gated on consumed_at — that's what makes the link reusable.
    expect(mockFindFirst.mock.calls[0][0].where).not.toHaveProperty('consumed_at');
    // A fresh session row is created (the durable link row is left untouched).
    const created = mockCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({
      token_type: 'client_session',
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      session_token: result!.sessionToken,
      action: 'login',
    });
    // The new row is a SESSION, not a link — it carries no magic_token.
    expect(created.magic_token).toBeUndefined();
  });

  it('is reusable: redeeming the same link twice mints two distinct sessions', async () => {
    mockFindFirst.mockResolvedValue(linkRow);
    mockCreate.mockResolvedValue({});

    const first = await consumeClientMagicLink({ magicToken: 'magic-abc', ...reqInput });
    const second = await consumeClientMagicLink({ magicToken: 'magic-abc', ...reqInput });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.sessionToken).not.toEqual(second!.sessionToken);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('returns null for an unknown token', async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await consumeClientMagicLink({ magicToken: 'nope', ...reqInput });
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null for an expired magic token', async () => {
    mockFindFirst.mockResolvedValue({
      ...linkRow,
      magic_token_expires_at: new Date(Date.now() - 60 * 1000),
    });
    const result = await consumeClientMagicLink({ magicToken: 'expired', ...reqInput });
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('validateClientSession', () => {
  it('returns the scope for an active session', async () => {
    mockFindFirst.mockResolvedValue({
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });
    const session = await validateClientSession('good-token');
    expect(session).toEqual({ clientId: 'client-acme', contactId: 'contact-1' });
  });

  it('rejects an expired session', async () => {
    mockFindFirst.mockResolvedValue({
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      expires_at: new Date(Date.now() - 1000),
    });
    expect(await validateClientSession('stale')).toBeNull();
  });

  it('rejects an empty token without a DB call', async () => {
    expect(await validateClientSession('')).toBeNull();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

describe('requireClientAuth', () => {
  it('returns the session when the cookie is valid', async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: 'good-token' }) });
    mockFindFirst.mockResolvedValue({
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });
    const session = await requireClientAuth();
    expect(session.clientId).toBe('client-acme');
  });

  it('throws 401 when there is no cookie', async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });
    await expect(requireClientAuth()).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 401 when the cookie is invalid/expired', async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: 'bad' }) });
    mockFindFirst.mockResolvedValue(null);
    await expect(requireClientAuth()).rejects.toBeInstanceOf(AuthError);
  });

  it('reads from the client_session cookie name', async () => {
    const get = vi.fn(() => ({ value: 'good-token' }));
    mockCookies.mockResolvedValue({ get });
    mockFindFirst.mockResolvedValue({
      entity_id: 'c', contact_id: 'x', expires_at: new Date(Date.now() + 1000),
    });
    await requireClientAuth();
    expect(get).toHaveBeenCalledWith(CLIENT_SESSION_COOKIE);
  });
});

describe('assertClientScope', () => {
  const session = { clientId: 'client-acme', contactId: 'contact-1' };

  it('allows access to the session\'s own client', () => {
    expect(() => assertClientScope(session, 'client-acme')).not.toThrow();
  });

  it('throws 403 on a cross-client access attempt', () => {
    expect(() => assertClientScope(session, 'client-other')).toThrow(AuthError);
    try {
      assertClientScope(session, 'client-other');
    } catch (e) {
      expect((e as AuthError).statusCode).toBe(403);
    }
  });
});
