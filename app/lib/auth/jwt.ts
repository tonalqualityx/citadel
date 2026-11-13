import { SignJWT, jwtVerify, JWTPayload } from 'jose';
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
  /** The API key row id when via is 'api_key'. */
  apiKeyId?: string;
}

export async function signAccessToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_ACCESS_EXPIRY || '1h')
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

export async function createOrUpdateSession(
  userId: string,
  refreshToken: string,
  days: number = DEFAULT_REFRESH_DAYS
): Promise<void> {
  let expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  // Upsert: create new session or update existing one for this user
  // This allows multiple tabs to share the same session
  const existingSession = await prisma.session.findFirst({
    where: { user_id: userId },
  });

  if (existingSession) {
    // One session row per user is shared by all devices: never shorten it, so a default sign-in
    // elsewhere cannot cut a "keep me signed in" device short. With no long session this is the
    // same as always (the stored expiry is never later than now + 7 days).
    if (existingSession.expires_at > expiresAt) expiresAt = existingSession.expires_at;
    await prisma.session.update({
      where: { id: existingSession.id },
      data: {
        refresh_token: refreshToken,
        expires_at: expiresAt,
      },
    });
  } else {
    await prisma.session.create({
      data: {
        user_id: userId,
        refresh_token: refreshToken,
        expires_at: expiresAt,
      },
    });
  }
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({
    where: { user_id: userId },
  });
}

export async function findSessionByUser(userId: string) {
  return prisma.session.findFirst({
    where: { user_id: userId },
    include: { user: true },
  });
}

// Legacy function for backwards compatibility during transition
export async function findSession(refreshToken: string) {
  return prisma.session.findUnique({
    where: { refresh_token: refreshToken },
    include: { user: true },
  });
}
