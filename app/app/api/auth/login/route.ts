import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { signAccessToken, signRefreshToken, createSession, KEEP_SIGNED_IN_DAYS } from '@/lib/auth/jwt';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { authRateLimit } from '@/lib/api/rate-limit';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  keep_signed_in: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  // Apply rate limiting (10 requests/minute for auth)
  const rateLimitResponse = authRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { email, password, keep_signed_in } = loginSchema.parse(body);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.is_active) {
      throw new ApiError('Invalid credentials', 401);
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      throw new ApiError('Invalid credentials', 401);
    }

    // Generate tokens
    const tokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const keep = keep_signed_in === true;
    const accessToken = await signAccessToken(tokenPayload);
    // One new session row per sign-in (per device); its id rides in the refresh token as `sid`.
    const sessionId = randomUUID();
    const refreshToken = await signRefreshToken({ ...tokenPayload, sid: sessionId, ...(keep ? { keep: true } : {}) });
    await createSession(user.id, sessionId, refreshToken, keep ? KEEP_SIGNED_IN_DAYS : undefined);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    // Create response with cookies
    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    });

    // Set HTTP-only cookies
    response.cookies.set('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 15, // 15 minutes
      path: '/',
    });

    response.cookies.set('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * (keep ? KEEP_SIGNED_IN_DAYS : 7), // 7 days unless ticked
      path: '/',
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
