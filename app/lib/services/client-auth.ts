/**
 * Client Portal Auth (C1)
 *
 * Magic-link login for client contacts → a 7-day, client-scoped browse session.
 *
 * SECURITY-CRITICAL. The whole point is isolation: a session may ONLY ever read its own
 * client's data — never another client's, never Indelible internals. Enforcement lives in
 * `requireClientAuth()` + `assertClientScope()`; route handlers must call both.
 *
 * Reuses the existing `PortalSession` model (token_type='client_session', entity_id=client_id,
 * tied to the contact). One login is one row:
 *   1. request phase — magic_token set, magic_token_expires_at = now+15m, session_token null
 *   2. consume phase — single-use: session_token set, expires_at = now+7d, consumed_at = now
 */

import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import { sendClientMagicLinkEmail } from '@/lib/services/email';

export const CLIENT_SESSION_COOKIE = 'client_session';
const TOKEN_TYPE = 'client_session';
const MAGIC_LINK_TTL_MINUTES = 15;
const SESSION_TTL_DAYS = 7;
/**
 * Team-generated invite links live longer than the 15-minute self-service link: Mike may copy a
 * link and paste it into an email he writes later, so it must still be valid when the client
 * eventually clicks. Still single-use and still client-scoped.
 */
const TEAM_INVITE_TTL_DAYS = 7;

export interface ClientSession {
  clientId: string;
  contactId: string;
}

/** Cryptographically secure 128-hex-char token (matches the portal token convention). */
function generateToken(): string {
  return randomBytes(64).toString('hex');
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Issue a magic link for every active contact matching the email and email each one its link.
 *
 * An email can be a contact for more than one client (`@@unique[client_id, email]`); each match
 * gets its own token scoped to that contact's client, so consuming a link can only ever produce
 * that client's session. Returns the number of links issued — callers should NOT leak this to
 * the public response (avoid email enumeration); it exists for logging/tests.
 */
export async function requestClientMagicLink(input: {
  email: string;
  ipAddress: string;
  userAgent: string | null;
}): Promise<number> {
  const contacts = await prisma.clientContact.findMany({
    where: { email: input.email, is_deleted: false },
    select: { id: true, name: true, email: true, client_id: true },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  for (const contact of contacts) {
    const magicToken = generateToken();
    await prisma.portalSession.create({
      data: {
        token_type: TOKEN_TYPE,
        entity_id: contact.client_id,
        contact_id: contact.id,
        magic_token: magicToken,
        magic_token_expires_at: minutesFromNow(MAGIC_LINK_TTL_MINUTES),
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        action: 'request',
      },
    });

    await sendClientMagicLinkEmail({
      to: contact.email,
      loginUrl: `${baseUrl}/api/portal/login/${magicToken}`,
      contactName: contact.name,
      expiresMinutes: MAGIC_LINK_TTL_MINUTES,
    });
  }

  return contacts.length;
}

/**
 * Team-side: mint a portal **login** link for a specific contact, so the team can proactively
 * invite a client in — either copying the URL (Mike pastes it into his own email) or having
 * Citadel email it (`send: true`). Unlike `requestClientMagicLink` (client-initiated, keyed by a
 * typed email, short 15-min TTL), this is keyed by a known contact id and uses the longer
 * `TEAM_INVITE_TTL_DAYS` window so a copied link survives until the client clicks. Still
 * single-use and still scoped to the contact's own client.
 *
 * Returns the link details, or `null` if the contact does not exist / is deleted. The email is
 * sent in the neutral Indelible voice and never references the internal worker persona.
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
    select: { id: true, name: true, email: true, client_id: true, is_deleted: true },
  });

  if (!contact || contact.is_deleted) return null;

  const magicToken = generateToken();
  const expiresAt = daysFromNow(TEAM_INVITE_TTL_DAYS);

  await prisma.portalSession.create({
    data: {
      token_type: TOKEN_TYPE,
      entity_id: contact.client_id,
      contact_id: contact.id,
      magic_token: magicToken,
      magic_token_expires_at: expiresAt,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      action: 'invite',
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = `${baseUrl}/api/portal/login/${magicToken}`;

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
 * Consume a magic link (single-use) → activate the 7-day session on the same row.
 * Returns the new session token + scope, or null if the token is invalid, expired, or already
 * consumed. Idempotency is enforced by `consumed_at: null` in the WHERE: a second consume of the
 * same token finds nothing and returns null.
 */
export async function consumeClientMagicLink(input: {
  magicToken: string;
  ipAddress: string;
  userAgent: string | null;
}): Promise<{ sessionToken: string; clientId: string; contactId: string; expiresAt: Date } | null> {
  const row = await prisma.portalSession.findFirst({
    where: {
      magic_token: input.magicToken,
      token_type: TOKEN_TYPE,
      consumed_at: null,
    },
    select: { id: true, entity_id: true, contact_id: true, magic_token_expires_at: true },
  });

  if (!row || !row.contact_id) return null;
  if (row.magic_token_expires_at && row.magic_token_expires_at < new Date()) return null;

  const sessionToken = generateToken();
  const expiresAt = daysFromNow(SESSION_TTL_DAYS);

  // Guard against a consume race: only the update that still sees consumed_at=null wins.
  const result = await prisma.portalSession.updateMany({
    where: { id: row.id, consumed_at: null },
    data: {
      session_token: sessionToken,
      expires_at: expiresAt,
      consumed_at: new Date(),
      action: 'login',
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
    },
  });

  if (result.count === 0) return null;

  return {
    sessionToken,
    clientId: row.entity_id,
    contactId: row.contact_id,
    expiresAt,
  };
}

/**
 * Resolve an active client session from a raw session token. Null if unknown or expired.
 */
export async function validateClientSession(sessionToken: string): Promise<ClientSession | null> {
  if (!sessionToken) return null;

  const row = await prisma.portalSession.findFirst({
    where: {
      session_token: sessionToken,
      token_type: TOKEN_TYPE,
    },
    select: { entity_id: true, contact_id: true, expires_at: true },
  });

  if (!row || !row.contact_id) return null;
  if (!row.expires_at || row.expires_at < new Date()) return null;

  return { clientId: row.entity_id, contactId: row.contact_id };
}

/**
 * Require an authenticated client-portal session (reads the `client_session` cookie).
 * Throws AuthError(401) when there is no valid session. The returned scope is the ONLY client
 * this request may touch — pair with `assertClientScope()` on any client-scoped resource.
 */
export async function requireClientAuth(): Promise<ClientSession> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_SESSION_COOKIE)?.value;

  if (!token) {
    throw new AuthError('Client authentication required', 401);
  }

  const session = await validateClientSession(token);
  if (!session) {
    throw new AuthError('Invalid or expired session', 401);
  }

  return session;
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
  TEAM_INVITE_TTL_DAYS,
};
