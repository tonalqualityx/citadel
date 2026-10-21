import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { AuthError } from '@/lib/api/errors';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientContact: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    portalSession: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
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
  revokeClientSession,
  revokeContactAccess,
  hashMagicToken,
  validateClientSession,
  requireClientAuth,
  assertClientScope,
  CLIENT_SESSION_COOKIE,
  SESSION_TTL_DAYS,
  MAX_SESSION_TTL_DAYS,
} from '../client-auth';
import type { Mock } from 'vitest';

const mockCookies = cookies as Mock;
const mockFindManyContacts = prisma.clientContact.findMany as Mock;
const mockFindUniqueContact = prisma.clientContact.findUnique as Mock;
const mockFindFirstContact = prisma.clientContact.findFirst as Mock;
const mockCreate = prisma.portalSession.create as Mock;
const mockFindFirst = prisma.portalSession.findFirst as Mock;
const mockUpdate = prisma.portalSession.update as Mock;
const mockUpdateMany = prisma.portalSession.updateMany as Mock;
const mockSendEmail = sendClientMagicLinkEmail as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the session's contact is live and holds a role.
  mockFindFirstContact.mockResolvedValue({ id: 'contact-1' });
});

const reqInput = { ipAddress: '1.2.3.4', userAgent: 'test-agent' };

describe('requestClientMagicLink', () => {
  const contacts = [
    { id: 'contact-1', name: 'Ann', email: 'ann@acme.com', client_id: 'client-acme' },
    { id: 'contact-2', name: 'Ann (Agency)', email: 'ann@acme.com', client_id: 'client-agency' },
  ];

  it('issues a hashed 15-minute link and emails each matching active contact', async () => {
    mockFindManyContacts.mockResolvedValue(contacts);
    mockFindFirst.mockResolvedValue(null); // no recent request
    mockCreate.mockResolvedValue({});

    const count = await requestClientMagicLink({ email: 'ann@acme.com', ...reqInput });

    expect(count).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    const created = mockCreate.mock.calls.map((c) => c[0].data);
    expect(created[0]).toMatchObject({ token_type: 'client_session', entity_id: 'client-acme', contact_id: 'contact-1', action: 'request' });
    expect(created[1]).toMatchObject({ entity_id: 'client-agency', contact_id: 'contact-2' });
    expect(created[0].magic_token_hash).not.toEqual(created[1].magic_token_hash);
    const ttlMs = created[0].magic_token_expires_at.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(14 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ expiresLabel: '15 minutes' });
  });

  it('stores only the SHA-256 hash: the raw token is in the emailed URL and nowhere in the row', async () => {
    mockFindManyContacts.mockResolvedValue([contacts[0]]);
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});

    await requestClientMagicLink({ email: 'ann@acme.com', ...reqInput });

    const data = mockCreate.mock.calls[0][0].data;
    const url: string = mockSendEmail.mock.calls[0][0].loginUrl;
    const rawToken = new URL(url).searchParams.get('token')!;
    expect(url).toContain('/portal/login/verify?token=');
    expect(rawToken).toMatch(/^[0-9a-f]{128}$/);
    expect(data.magic_token_hash).toBe(createHash('sha256').update(rawToken).digest('hex'));
    expect(data.magic_token_hash).toBe(hashMagicToken(rawToken));
    expect(data.magic_token_hash).toHaveLength(64);
    // No column carries the raw token.
    expect(data.magic_token).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(rawToken);
  });

  it('rate limit: a second request inside 60 seconds mints and sends nothing', async () => {
    mockFindManyContacts.mockResolvedValue(contacts);
    mockFindFirst.mockResolvedValue({ id: 'earlier-request' });

    const count = await requestClientMagicLink({ email: 'ann@acme.com', ...reqInput });

    expect(count).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    const where = mockFindFirst.mock.calls[0][0].where;
    expect(where.action).toBe('request');
    const windowStart = where.created_at.gte.getTime();
    expect(Date.now() - windowStart).toBeGreaterThanOrEqual(59_000);
    expect(Date.now() - windowStart).toBeLessThanOrEqual(61_000);
  });

  it('does nothing (and sends no email) when no contact matches', async () => {
    mockFindManyContacts.mockResolvedValue([]);

    const count = await requestClientMagicLink({ email: 'nobody@nowhere.com', ...reqInput });

    expect(count).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('skips portal role none contacts in the lookup', async () => {
    mockFindManyContacts.mockResolvedValue([]);
    await requestClientMagicLink({ email: 'ann@acme.com', ...reqInput });
    expect(mockFindManyContacts.mock.calls[0][0].where).toMatchObject({
      is_deleted: false,
      portal_role: { not: 'none' },
    });
  });
});

describe('createContactPortalLoginLink', () => {
  const contact = {
    id: 'contact-1',
    name: 'Ann',
    email: 'ann@acme.com',
    client_id: 'client-acme',
    is_deleted: false,
    portal_role: 'member',
  };

  it('mints a hashed 7-day single-use invite for that one contact and returns the interstitial URL (copy)', async () => {
    mockFindUniqueContact.mockResolvedValue(contact);
    mockCreate.mockResolvedValue({});

    const result = await createContactPortalLoginLink({ contactId: 'contact-1', send: false, ...reqInput });

    expect(result).not.toBeNull();
    expect(result!.sent).toBe(false);
    expect(result!.contact).toMatchObject({ id: 'contact-1', email: 'ann@acme.com', clientId: 'client-acme' });
    expect(result!.url).toContain('/portal/login/verify?token=');
    expect(mockSendEmail).not.toHaveBeenCalled();

    const created = mockCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({
      token_type: 'client_session',
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      action: 'invite',
    });
    const rawToken = new URL(result!.url).searchParams.get('token')!;
    expect(created.magic_token_hash).toBe(hashMagicToken(rawToken));
    expect(created.magic_token).toBeUndefined();
    expect(JSON.stringify(created)).not.toContain(rawToken);
    const ttl = created.magic_token_expires_at.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it('emails the contact their link when send=true', async () => {
    mockFindUniqueContact.mockResolvedValue(contact);
    mockCreate.mockResolvedValue({});

    const result = await createContactPortalLoginLink({ contactId: 'contact-1', send: true, ...reqInput });

    expect(result!.sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ to: 'ann@acme.com', loginUrl: result!.url, expiresLabel: '7 days' });
  });

  it('returns null for an unknown, deleted, or role none contact (and never emails)', async () => {
    mockFindUniqueContact.mockResolvedValue(null);
    expect(await createContactPortalLoginLink({ contactId: 'nope', send: true, ...reqInput })).toBeNull();

    mockFindUniqueContact.mockResolvedValue({ ...contact, is_deleted: true });
    expect(await createContactPortalLoginLink({ contactId: 'contact-1', send: true, ...reqInput })).toBeNull();

    mockFindUniqueContact.mockResolvedValue({ ...contact, portal_role: 'none' });
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
    magic_token_expires_at: new Date(Date.now() + 5 * 60 * 1000),
    consumed_at: null,
  };

  beforeEach(() => {
    mockFindUniqueContact.mockResolvedValue({ is_deleted: false, portal_role: 'member' });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockCreate.mockResolvedValue({});
  });

  it('claims the link row atomically and mints a fresh 30-day session row', async () => {
    mockFindFirst.mockResolvedValue(linkRow);

    const result = await consumeClientMagicLink({ magicToken: 'magic-abc', ...reqInput });

    expect(result).not.toBeNull();
    expect(result!.clientId).toBe('client-acme');
    expect(result!.contactId).toBe('contact-1');
    const ms = result!.expiresAt.getTime() - Date.now();
    const ttlMs = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(ms).toBeGreaterThan(ttlMs - 60_000);
    expect(ms).toBeLessThan(ttlMs + 60_000);
    // Lookup is by hash, never by the raw token.
    expect(mockFindFirst.mock.calls[0][0].where.magic_token_hash).toBe(hashMagicToken('magic-abc'));
    // Claim is one conditional update on consumed_at null.
    const claim = mockUpdateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'link-1', consumed_at: null });
    expect(claim.data.consumed_at).toBeInstanceOf(Date);
    const created = mockCreate.mock.calls[0][0].data;
    expect(created).toMatchObject({
      token_type: 'client_session',
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      session_token: result!.sessionToken,
      action: 'login',
    });
    expect(created.magic_token_hash).toBeUndefined();
  });

  it('second consume of the same link fails (single use)', async () => {
    // First attempt wins the claim; the link row now reads as consumed.
    mockFindFirst.mockResolvedValueOnce(linkRow);
    const first = await consumeClientMagicLink({ magicToken: 'magic-abc', ...reqInput });
    expect(first).not.toBeNull();

    mockFindFirst.mockResolvedValueOnce({ ...linkRow, consumed_at: new Date() });
    const second = await consumeClientMagicLink({ magicToken: 'magic-abc', ...reqInput });
    expect(second).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('a concurrent consume that loses the atomic claim gets null and mints no session', async () => {
    mockFindFirst.mockResolvedValue(linkRow);
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const result = await consumeClientMagicLink({ magicToken: 'magic-abc', ...reqInput });
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null for an unknown token', async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await consumeClientMagicLink({ magicToken: 'nope', ...reqInput })).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null for an expired link', async () => {
    mockFindFirst.mockResolvedValue({ ...linkRow, magic_token_expires_at: new Date(Date.now() - 60 * 1000) });
    expect(await consumeClientMagicLink({ magicToken: 'expired', ...reqInput })).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns null when the contact was deleted or set to role none after the link was issued', async () => {
    mockFindFirst.mockResolvedValue(linkRow);
    mockFindUniqueContact.mockResolvedValue({ is_deleted: true, portal_role: 'member' });
    expect(await consumeClientMagicLink({ magicToken: 'm', ...reqInput })).toBeNull();
    mockFindUniqueContact.mockResolvedValue({ is_deleted: false, portal_role: 'none' });
    expect(await consumeClientMagicLink({ magicToken: 'm', ...reqInput })).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('logout and contact revocation', () => {
  it('revokeClientSession marks only that live session revoked', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    await revokeClientSession('sess-1');
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { session_token: 'sess-1', token_type: 'client_session', revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
  });

  it('revokeClientSession with no token is a no-op', async () => {
    await revokeClientSession('');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('revokeContactAccess revokes every live session and burns unused links', async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 3 }).mockResolvedValueOnce({ count: 1 });
    const n = await revokeContactAccess('contact-1');
    expect(n).toBe(3);
    expect(mockUpdateMany.mock.calls[0][0].where).toMatchObject({ contact_id: 'contact-1', session_token: { not: null }, revoked_at: null });
    expect(mockUpdateMany.mock.calls[1][0].where).toMatchObject({ contact_id: 'contact-1', magic_token_hash: { not: null }, consumed_at: null });
  });

  it('a revoked session row is not found by the validate lookup (filters revoked_at null)', async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await validateClientSession('sess-revoked')).toBeNull();
    expect(mockFindFirst.mock.calls[0][0].where).toMatchObject({ session_token: 'sess-revoked', revoked_at: null });
  });

  it('requireClientAuth throws 401 for a revoked session', async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: 'sess-revoked' }), set: vi.fn() });
    mockFindFirst.mockResolvedValue(null);
    await expect(requireClientAuth()).rejects.toMatchObject({ statusCode: 401 });
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

describe('session revocation (deleted contact or role none)', () => {
  const liveRow = {
    id: 's1',
    entity_id: 'client-acme',
    contact_id: 'contact-1',
    expires_at: new Date(Date.now() + 10 * 86_400_000),
    created_at: new Date(),
  };

  it('looks the contact up as non-deleted and role != none', async () => {
    mockFindFirst.mockResolvedValue(liveRow);
    await validateClientSession('tok');
    expect(mockFindFirstContact).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'contact-1', is_deleted: false, portal_role: { not: 'none' }, client: { is_deleted: false } } })
    );
  });

  it('validateClientSession returns null when the contact is deleted or role none', async () => {
    mockFindFirst.mockResolvedValue(liveRow);
    mockFindFirstContact.mockResolvedValue(null);
    expect(await validateClientSession('tok')).toBeNull();
  });

  it('requireClientAuth throws 401 for a revoked contact and never slides the session', async () => {
    mockCookies.mockResolvedValue({ get: () => ({ value: 'tok' }), set: vi.fn() });
    mockFindFirst.mockResolvedValue(liveRow);
    mockFindFirstContact.mockResolvedValue(null);
    await expect(requireClientAuth()).rejects.toMatchObject({ statusCode: 401 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('requireClientAuth', () => {
  it('returns the session when the cookie is valid', async () => {
    const set = vi.fn();
    mockCookies.mockResolvedValue({ get: () => ({ value: 'good-token' }), set });
    mockFindFirst.mockResolvedValue({
      id: 'session-1',
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
      created_at: new Date(Date.now() - 60 * 60 * 1000),
    });
    mockUpdate.mockResolvedValue({});
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
    const set = vi.fn();
    mockCookies.mockResolvedValue({ get, set });
    mockFindFirst.mockResolvedValue({
      id: 'session-1', entity_id: 'c', contact_id: 'x',
      expires_at: new Date(Date.now() + 1000), created_at: new Date(),
    });
    mockUpdate.mockResolvedValue({});
    await requireClientAuth();
    expect(get).toHaveBeenCalledWith(CLIENT_SESSION_COOKIE);
  });
});

describe('requireClientAuth — sliding session refresh', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('extends a near-expiry session forward and re-sets the cookie', async () => {
    const set = vi.fn();
    mockCookies.mockResolvedValue({ get: () => ({ value: 'good-token' }), set });
    // Created 20 days ago, expiring in 2 days — well inside the 90-day cap, so the slide should
    // land at ~SESSION_TTL_DAYS (30) from now, not the cap.
    mockFindFirst.mockResolvedValue({
      id: 'session-1',
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      expires_at: new Date(Date.now() + 2 * DAY_MS),
      created_at: new Date(Date.now() - 20 * DAY_MS),
    });
    mockUpdate.mockResolvedValue({});

    await requireClientAuth();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [{ where, data }] = mockUpdate.mock.calls[0];
    expect(where).toEqual({ id: 'session-1' });
    const slidMs = data.expires_at.getTime() - Date.now();
    const ttlMs = SESSION_TTL_DAYS * DAY_MS;
    expect(slidMs).toBeGreaterThan(ttlMs - 60_000);
    expect(slidMs).toBeLessThan(ttlMs + 60_000);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][0]).toBe(CLIENT_SESSION_COOKIE);
  });

  it('does not write when the extension would not be meaningful (debounce)', async () => {
    const set = vi.fn();
    mockCookies.mockResolvedValue({ get: () => ({ value: 'good-token' }), set });
    // A session that was just refreshed — already sitting at ~SESSION_TTL_DAYS out.
    mockFindFirst.mockResolvedValue({
      id: 'session-1',
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      expires_at: new Date(Date.now() + SESSION_TTL_DAYS * DAY_MS - 60_000),
      created_at: new Date(Date.now() - DAY_MS),
    });

    await requireClientAuth();

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('caps the slide at MAX_SESSION_TTL_DAYS from the session\'s own creation', async () => {
    const set = vi.fn();
    mockCookies.mockResolvedValue({ get: () => ({ value: 'good-token' }), set });
    // Created 85 days ago — a full 30-day slide would blow past the 90-day absolute cap, which
    // lands only 5 days out from now.
    const createdAt = new Date(Date.now() - 85 * DAY_MS);
    mockFindFirst.mockResolvedValue({
      id: 'session-1',
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      expires_at: new Date(Date.now() + 2 * DAY_MS),
      created_at: createdAt,
    });
    mockUpdate.mockResolvedValue({});

    await requireClientAuth();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const capMs = createdAt.getTime() + MAX_SESSION_TTL_DAYS * DAY_MS;
    const [{ data }] = mockUpdate.mock.calls[0];
    expect(data.expires_at.getTime()).toBe(capMs);
  });

  it('never blocks the request when the DB write fails (best-effort)', async () => {
    const set = vi.fn();
    mockCookies.mockResolvedValue({ get: () => ({ value: 'good-token' }), set });
    mockFindFirst.mockResolvedValue({
      id: 'session-1',
      entity_id: 'client-acme',
      contact_id: 'contact-1',
      expires_at: new Date(Date.now() + 2 * DAY_MS),
      created_at: new Date(Date.now() - 20 * DAY_MS),
    });
    mockUpdate.mockRejectedValue(new Error('db down'));

    const session = await requireClientAuth();

    expect(session.clientId).toBe('client-acme');
    expect(set).not.toHaveBeenCalled();
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
