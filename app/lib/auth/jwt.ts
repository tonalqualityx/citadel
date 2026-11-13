import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const JWT_REFRESH_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET);

export interface TokenPayload extends JWTPayload {
  userId: string;
  email: string;
  role: string;
  /**
   * How this request signed in, set by requireAuth and never read from a token: 'session' is the
   * browser login cookie, 'api_key' is a Bearer API key (including the machine token). Optional so
   * the signing helpers do not need it.
   */
  via?: 'session' | 'api_key';
  /**
   * Refresh tokens only: the staff sign-in ticked "Keep me signed in on this device". Part of the
   * signed token, so it cannot be added or changed without JWT_REFRESH_SECRET.
   */
  keep?: boolean;
  /**
   * Refresh tokens only: the id of the one session row (one per sign-in, so one per device) this
   * token belongs to. Refresh finds that row by this id, so signing out and signing in again can
   * never revive an older device's token. Part of the signed token.
   */
  sid?: string;
  /** The API key row id when via is 'api_key'. */
  apiKeyId?: string;
}

export async function signAccessToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    // 15 minutes, the same as the access cookie, so a copied access token does not outlive its cookie.
    .setExpirationTime(process.env.JWT_ACCESS_EXPIRY || '15m')
    .sign(JWT_SECRET);
}

/** Lifetime of a refresh token (and its session) for a device that ticked "Keep me signed in". */
export const KEEP_SIGNED_IN_DAYS = 30;
export const DEFAULT_REFRESH_DAYS = 7;

export async function signRefreshToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): Promise<string> {
  const keep = payload.keep === true;
  return new SignJWT(keep ? { ...payload, keep: true } : payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(keep ? `${KEEP_SIGNED_IN_DAYS}d` : process.env.JWT_REFRESH_EXPIRY || '7d')
    .sign(JWT_REFRESH_SECRET);
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as TokenPayload;
}

export async function verifyRefreshToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, JWT_REFRESH_SECRET);
  return payload as TokenPayload;
}

/**
 * What the session row stores for a refresh token: its SHA-256 as 64 hex characters. The row is bound
 * by `sid`, never compared to the token, so the raw token (a live credential) is not kept, and the
 * stored length no longer depends on the email inside the token.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Sign-in: one NEW session row per sign-in (id = the `sid` carried in the refresh token), so each
 * device has its own row. The user's expired rows are removed at the same time; their live rows
 * (other devices) stay.
 */
export async function createSession(
  userId: string,
  sessionId: string,
  refreshToken: string,
  days: number = DEFAULT_REFRESH_DAYS
): Promise<void> {
  const expiresAt = new Date(Date.now() + days * 86400 * 1000);
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { user_id: userId, expires_at: { lt: new Date() } } }),
    prisma.session.create({
      data: { id: sessionId, user_id: userId, refresh_token: hashRefreshToken(refreshToken), expires_at: expiresAt },
    }),
  ]);
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { user_id: userId },
  });
}

/** The session row a refresh token's `sid` names, with its user. Null when there is no such row. */
export async function findSessionById(sessionId: string) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
}
