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
 * tied to the contact). The magic-link row is a durable, reusable credential; each redemption
 * mints its OWN session row:
 *   1. request/invite phase — a link row: magic_token set, magic_token_expires_at = now+7d,
 *      session_token null. This row is the shareable link and is NEVER consumed.
 *   2. redeem phase — each click on a still-valid link CREATES a fresh session row
 *      (session_token set, expires_at = now+7d). The link works any number of times until it
 *      expires, so a client can share it with their team and meta-preview crawlers can't burn it.
 *
 * NOTE (per Mike, 2026-06-24): the link is intentionally reusable-for-7-days rather than
 * single-use. This is a deliberate, temporary tradeoff for a small team-sharing use case — a
 * forwarded/leaked link grants its client's scope for up to 7 days. It will be tightened when the
 * full per-contact login lands.
 */

import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { AuthError } from '@/lib/api/errors';
import { sendClientMagicLinkEmail } from '@/lib/services/email';

export const CLIENT_SESSION_COOKIE = 'client_session';
const TOKEN_TYPE = 'client_session';
/**
 * Both the self-service request link and the team-generated invite link are valid for 7 days and
 * reusable within that window (so the client can share one link with their team, and link
 * prefetchers can't burn it). Still client-scoped on every redemption.
 */
const MAGIC_LINK_TTL_DAYS = 7;
const SESSION_TTL_DAYS = 7;
const TEAM_INVITE_TTL_DAYS = 7;

export interface ClientSession {
  clientId: string;
  contactId: string;
}

/** Cryptographically secure 128-hex-char token (matches the portal token convention). */
function generateToken(): string {
  return randomBytes(64).toString('hex');
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
        magic_token_expires_at: daysFromNow(MAGIC_LINK_TTL_DAYS),
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        action: 'request',
      },
    });

    await sendClientMagicLinkEmail({
      to: contact.email,
      loginUrl: `${baseUrl}/api/portal/login/${magicToken}`,
      contactName: contact.name,
      expiresLabel: `${MAGIC_LINK_TTL_DAYS} days`,
    });
  }

  return contacts.length;
}

/**
 * Team-side: mint a portal **login** link for a specific contact, so the team can proactively
 * invite a client in — either copying the URL (Mike pastes it into his own email) or having
 * Citadel email it (`send: true`). Unlike `requestClientMagicLink` (client-initiated, keyed by a
 * typed email), this is keyed by a known contact id. Both use the same 7-day window and are
 * reusable within it; this one is always scoped to the contact's own client.
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
 * Redeem a magic link → start a fresh 7-day client-scoped session. REUSABLE: the magic-link row
 * is a durable credential and is never consumed; each redemption mints its OWN new session row, so
 * the same link can sign in any number of people/browsers until it expires (7-day window). This is
 * what lets a client share one link with their team, and why a meta-preview crawler GETting the
 * link can't lock anyone out. Returns the new session token + scope, or null if the token is
 * unknown or its magic-link window has expired.
 *
 * (Named `consume*` for historical continuity with the [token] route; despite the name it no
 * longer consumes the link — see the module header for the deliberate reusable-for-7-days model.)
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
    },
    select: { id: true, entity_id: true, contact_id: true, magic_token_expires_at: true },
  });

  if (!row || !row.contact_id) return null;
  if (row.magic_token_expires_at && row.magic_token_expires_at < new Date()) return null;

  const sessionToken = generateToken();
  const expiresAt = daysFromNow(SESSION_TTL_DAYS);

  // Mint a NEW session row per redemption (don't touch the reusable link row). Each browser gets
  // its own independent session_token, so multiple team members can use the one shared link.
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
  MAGIC_LINK_TTL_DAYS,
  SESSION_TTL_DAYS,
  TEAM_INVITE_TTL_DAYS,
};
