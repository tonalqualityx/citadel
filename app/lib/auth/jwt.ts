import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { prisma } from '@/lib/db/prisma';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const JWT_REFRESH_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET);

export interface TokenPayload extends JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export async function signAccessToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_ACCESS_EXPIRY || '1h')
    .sign(JWT_SECRET);
}

export async function signRefreshToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(process.env.JWT_REFRESH_EXPIRY || '7d')
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

export async function createOrUpdateSession(userId: string, refreshToken: string): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  // Upsert: create new session or update existing one for this user
  // This allows multiple tabs to share the same session
  const existingSession = await prisma.session.findFirst({
    where: { user_id: userId },
  });

  if (existingSession) {
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
