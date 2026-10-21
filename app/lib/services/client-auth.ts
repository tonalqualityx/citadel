/**
 * Client Portal Auth (C1, hardened in portal A2)
 *
 * Magic-link login for client contacts -> a 30-day sliding, client-scoped session.
 *
 * SECURITY-CRITICAL. The whole point is isolation: a session may ONLY ever read its own
 * client's data - never another client's, never Indelible internals. Enforcement lives in
 * `requireClientAuth()` + `assertClientScope()`; route handlers must call both.
 *
 * Reuses the existing `PortalSession` model (token_type='client_session', entity_id=client_id,
 * tied to the contact):
 *   1. request/invite phase - a link row: only the SHA-256 hash of the token is stored
 *      (`magic_token_hash`; the raw token exists only in the email/URL). TTL is 15 minutes when
 *      the contact requested it, 7 days when the team issued it as an invite. SINGLE USE.
 *   2. consume phase - a POST from the /portal/login/verify interstitial claims the link row
 *      atomically (`consumed_at`), then mints a fresh session row (session_token, expires_at).
 *      A GET never consumes, so mail scanners and link previewers cannot burn a link.
 *   3. sessions slide 30 days on activity, hard-capped at 90 days from creation. They can be
 *      revoked (`revoked_at`) by logout, by deleting the contact, or by setting portal_role none.
 *
 * Legacy rows (raw `magic_token`, reusable link) are never matched by the hash lookup, so any
 * pre-A2 reusable link is dead on deploy. Existing logged-in sessions keep working.
 */

import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import { sendClientMagicLinkEmail } from '@/lib/services/email';

export const CLIENT_SESSION_COOKIE = 'client_session';
const TOKEN_TYPE = 'client_session';
/** A link the contact requested for themselves. */
const MAGIC_LINK_TTL_MINUTES = 15;
/** A link a team member issued for one specific contact (copied or emailed). */
const TEAM_INVITE_TTL_DAYS = 7;
/** At most one login request per email in this window; extra requests are silently ignored. */
export const REQUEST_COOLDOWN_MS = 60 * 1000;
/** A logged-in session's sliding window: each activity extends it this far into the future. */
export const SESSION_TTL_DAYS = 30;
/** Absolute cap on a session's lifetime from its own `created_at`, regardless of activity. */
export const MAX_SESSION_TTL_DAYS = 90;
/** Only write the extended expiry (DB + cookie) when it moves the deadline by more than this —
 *  avoids a write + Set-Cookie on every single portal request. */
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface ClientSession {
  clientId: string;
  contactId: string;
}

/** Cryptographically secure 128-hex-char token (matches the portal token convention). */
function generateToken(): string {
  return randomBytes(64).toString('hex');
}

/** SHA-256 hex (64 chars) of a magic-link token. Only this is ever stored. */
export function hashMagicToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/** The interstitial page the email links to. Opening it consumes nothing. */
function verifyUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/portal/login/verify?token=${token}`;
}

/**
 * Issue a single-use magic link for every active, portal-enabled contact matching the email and
 * email each one its link.
 *
 * An email can be a contact for more than one client (`@@unique[client_id, email]`); each match
 * gets its own token scoped to that contact's client, so consuming a link can only ever produce
 * that client's session. Rate limit: if any of those contacts already requested a link within
 * `REQUEST_COOLDOWN_MS`, nothing is minted or sent. Returns the number of links issued - callers
 * must NOT leak this to the public response (no email enumeration); it exists for logging/tests.
 */
export async function requestClientMagicLink(input: {
  email: string;
  ipAddress: string;
  userAgent: string | null;
}): Promise<number> {
  const contacts = await prisma.clientContact.findMany({
    where: { email: input.email, is_deleted: false, portal_role: { not: 'none' } },
    select: { id: true, name: true, email: true, client_id: true },
  });
  if (contacts.length === 0) return 0;

  const recent = await prisma.portalSession.findFirst({
    where: {
      token_type: TOKEN_TYPE,
      action: 'request',
      contact_id: { in: contacts.map((c) => c.id) },
      created_at: { gte: new Date(Date.now() - REQUEST_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) return 0;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  for (const contact of contacts) {
    const magicToken = generateToken();
    await prisma.portalSession.create({
      data: {
        token_type: TOKEN_TYPE,
        entity_id: contact.client_id,
        contact_id: contact.id,
        magic_token_hash: hashMagicToken(magicToken),
        magic_token_expires_at: minutesFromNow(MAGIC_LINK_TTL_MINUTES),
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        action: 'request',
      },
    });

    await sendClientMagicLinkEmail({
      to: contact.email,
      loginUrl: verifyUrl(baseUrl, magicToken),
      contactName: contact.name,
      expiresLabel: `${MAGIC_LINK_TTL_MINUTES} minutes`,
    });
  }

  return contacts.length;
}

/**
 * Team-side: mint a single-use portal **invite** link for ONE specific contact (copy the URL, or
 * have Citadel email it with `send: true`). 7-day TTL, hashed at rest, consumed only by the
 * interstitial POST. It signs in that contact only - there is no shareable team link; every
 * person gets their own contact row and their own invite.
 *
 * Returns the link details, or `null` if the contact does not exist, is deleted, or has portal
 * role none. The email is sent in the neutral Indelible voice.
 */
export async function createContactPortalLoginLink(input: {
  contactId: string;
  send: boolean;
  ipAddress: string;
  userAgent: string | null;
}): Promise<{
  url: string;
  expiresAt: Date;
  sent: boolean;
  contact: { id: string; name: string | null; email: string; clientId: string };
} | null> {
  const contact = await prisma.clientContact.findUnique({
    where: { id: input.contactId },
    select: { id: true, name: true, email: true, client_id: true, is_deleted: true, portal_role: true },
  });

  if (!contact || contact.is_deleted || contact.portal_role === 'none') return null;

  const magicToken = generateToken();
  const expiresAt = daysFromNow(TEAM_INVITE_TTL_DAYS);

  await prisma.portalSession.create({
    data: {
      token_type: TOKEN_TYPE,
      entity_id: contact.client_id,
      contact_id: contact.id,
      magic_token_hash: hashMagicToken(magicToken),
      magic_token_expires_at: expiresAt,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      action: 'invite',
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = verifyUrl(baseUrl, magicToken);

  if (input.send) {
    await sendClientMagicLinkEmail({
      to: contact.email,
      loginUrl: url,
      contactName: contact.name,
      expiresLabel: `${TEAM_INVITE_TTL_DAYS} days`,
    });
  }

  return {
    url,
    expiresAt,
    sent: input.send,
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      clientId: contact.client_id,
    },
  };
}

/**
 * Consume a magic link -> start a fresh client-scoped session. SINGLE USE: the link row is
 * claimed with one conditional update (`consumed_at` null -> now), so of two concurrent or
 * repeated attempts exactly one wins. Called ONLY from the POST /api/portal/login/consume route
 * (the interstitial); no GET path reaches it. Returns null for an unknown, already-used or
 * expired token, or when the contact has since been deleted or set to portal role none.
 */
export async function consumeClientMagicLink(input: {
  magicToken: string;
  ipAddress: string;
  userAgent: string | null;
}): Promise<{ sessionToken: string; clientId: string; contactId: string; expiresAt: Date } | null> {
  if (!input.magicToken) return null;
  const tokenHash = hashMagicToken(input.magicToken);

  const row = await prisma.portalSession.findFirst({
    where: { magic_token_hash: tokenHash, token_type: TOKEN_TYPE },
    select: {
      id: true,
      entity_id: true,
      contact_id: true,
      magic_token_expires_at: true,
      consumed_at: true,
    },
  });

  if (!row || !row.contact_id) return null;
  if (row.consumed_at) return null;
  if (!row.magic_token_expires_at || row.magic_token_expires_at < new Date()) return null;

  const contact = await prisma.clientContact.findUnique({
    where: { id: row.contact_id },
    select: { is_deleted: true, portal_role: true },
  });
  if (!contact || contact.is_deleted || contact.portal_role === 'none') return null;

  // Atomic claim. count 0 means another request consumed it between our read and now.
  const claim = await prisma.portalSession.updateMany({
    where: {
      id: row.id,
      consumed_at: null,
      magic_token_expires_at: { gt: new Date() },
    },
    data: { consumed_at: new Date() },
  });
  if (claim.count !== 1) return null;

  const sessionToken = generateToken();
  const expiresAt = daysFromNow(SESSION_TTL_DAYS);

  await prisma.portalSession.create({
    data: {
      token_type: TOKEN_TYPE,
      entity_id: row.entity_id,
      contact_id: row.contact_id,
      session_token: sessionToken,
      expires_at: expiresAt,
      consumed_at: new Date(),
      action: 'login',
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
    },
  });

  return {
    sessionToken,
    clientId: row.entity_id,
    contactId: row.contact_id,
    expiresAt,
  };
}

/** End one session (logout). Idempotent; unknown tokens are a no-op. */
export async function revokeClientSession(sessionToken: string): Promise<void> {
  if (!sessionToken) return;
  await prisma.portalSession.updateMany({
    where: { session_token: sessionToken, token_type: TOKEN_TYPE, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

/**
 * Cut a contact off: revoke every live session AND burn every unused login link. Called when a
 * contact is deleted or its portal_role is set to none. Returns the number of sessions revoked.
 */
export async function revokeContactAccess(contactId: string): Promise<number> {
  const now = new Date();
  const sessions = await prisma.portalSession.updateMany({
    where: {
      contact_id: contactId,
      token_type: TOKEN_TYPE,
      session_token: { not: null },
      revoked_at: null,
    },
    data: { revoked_at: now },
  });
  await prisma.portalSession.updateMany({
    where: {
      contact_id: contactId,
      token_type: TOKEN_TYPE,
      magic_token_hash: { not: null },
      consumed_at: null,
    },
    data: { consumed_at: now },
  });
  return sessions.count;
}

interface ActiveSessionRow {
  id: string;
  entity_id: string;
  contact_id: string;
  expires_at: Date;
  created_at: Date;
  revoked_at?: Date | null;
}

/**
 * Look up a session row by token and return it only if it's a real, unexpired client-login
 * session. Shared by `validateClientSession()` (identity-only callers) and `requireClientAuth()`
 * (which additionally needs `id`/`created_at`/`expires_at` to drive the sliding refresh).
 */
async function findActiveSessionRow(sessionToken: string): Promise<ActiveSessionRow | null> {
  if (!sessionToken) return null;

  const row = await prisma.portalSession.findFirst({
    where: {
      session_token: sessionToken,
      token_type: TOKEN_TYPE,
      revoked_at: null,
    },
    select: {
      id: true,
      entity_id: true,
      contact_id: true,
      expires_at: true,
      created_at: true,
      revoked_at: true,
    },
  });

  if (!row || !row.contact_id || !row.expires_at) return null;
  if (row.revoked_at) return null;
  if (row.expires_at < new Date()) return null;

  return row as ActiveSessionRow;
}

/**
 * Resolve an active client session from a raw session token. Null if unknown or expired.
 * Identity-only — does not slide the session (no cookie access here); pair with
 * `requireClientAuth()` for the full cookie-backed, self-extending flow.
 */
export async function validateClientSession(sessionToken: string): Promise<ClientSession | null> {
  const row = await findActiveSessionRow(sessionToken);
  if (!row) return null;

  return { clientId: row.entity_id, contactId: row.contact_id };
}

/**
 * Extend a session on activity: slides `expires_at` forward by `SESSION_TTL_DAYS`, capped at
 * `MAX_SESSION_TTL_DAYS` from the session's own `created_at`. Debounced — only writes (DB +
 * cookie) when the extension is meaningful, per `REFRESH_THRESHOLD_MS`. Best-effort: a failed
 * write never blocks the request, it just means this particular activity didn't slide the window.
 */
async function slideSessionExpiry(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  token: string,
  row: ActiveSessionRow
): Promise<void> {
  const now = Date.now();
  const absoluteCapMs = row.created_at.getTime() + MAX_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  const slidingTargetMs = now + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
  const newExpiresMs = Math.min(slidingTargetMs, absoluteCapMs);
  const currentExpiresMs = row.expires_at.getTime();

  if (newExpiresMs - currentExpiresMs <= REFRESH_THRESHOLD_MS) return;

  const newExpiresAt = new Date(newExpiresMs);

  try {
    await prisma.portalSession.update({
      where: { id: row.id },
      data: { expires_at: newExpiresAt },
    });
  } catch (error) {
    console.error('Failed to slide client session expiry:', error);
    return;
  }

  cookieStore.set(CLIENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: Math.max(0, Math.floor((newExpiresMs - now) / 1000)),
    path: '/',
  });
}

/**
 * Require an authenticated client-portal session (reads the `client_session` cookie).
 * Throws AuthError(401) when there is no valid session. The returned scope is the ONLY client
 * this request may touch — pair with `assertClientScope()` on any client-scoped resource.
 *
 * Sliding session: on every successful call, extends the session's expiry (DB row + cookie) up to
 * `MAX_SESSION_TTL_DAYS` from its creation — see `slideSessionExpiry()`.
 */
export async function requireClientAuth(): Promise<ClientSession> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;

  if (!token) {
    throw new AuthError('Client authentication required', 401);
  }

  const row = await findActiveSessionRow(token);
  if (!row) {
    throw new AuthError('Invalid or expired session', 401);
  }

  await slideSessionExpiry(cookieStore, token, row);

  return { clientId: row.entity_id, contactId: row.contact_id };
}

/**
 * Enforce that a client session may only access its own client's data.
 * Throws AuthError(403) on any cross-client access attempt.
 */
export function assertClientScope(session: ClientSession, clientId: string): void {
  if (session.clientId !== clientId) {
    throw new AuthError('Forbidden', 403);
  }
}

export const __testing = {
  MAGIC_LINK_TTL_MINUTES,
  SESSION_TTL_DAYS,
  MAX_SESSION_TTL_DAYS,
  TEAM_INVITE_TTL_DAYS,
};
