import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { authRateLimit } from '@/lib/api/rate-limit';
import { sendPasswordResetEmail } from '@/lib/services/email';

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

// Token expires in 1 hour
const TOKEN_EXPIRY_HOURS = 1;

export async function POST(request: NextRequest) {
  // Apply rate limiting (stricter for password reset)
  const rateLimitResponse = authRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    // Always return success to prevent email enumeration
    const successResponse = NextResponse.json({
      message: 'If an account exists with that email, you will receive a password reset link.',
    });

    // Find user (but don't reveal if they exist)
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, is_active: true },
    });

    // Only proceed if user exists and is active
    if (!user || !user.is_active) {
      // Return success anyway to prevent email enumeration
      return successResponse;
    }

    // Check for recent reset requests (rate limit per email)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentTokens = await prisma.passwordResetToken.count({
      where: {
        user_id: user.id,
        created_at: { gte: oneHourAgo },
      },
    });

    // Allow max 3 reset requests per hour per user
    if (recentTokens >= 3) {
      // Still return success to prevent enumeration
      console.log(`Rate limited password reset for user ${user.id}`);
      return successResponse;
    }

    // Generate secure random token
    const token = randomBytes(32).toString('hex');

    // Calculate expiry
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    // Store token in database
    await prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token,
        expires_at: expiresAt,
      },
    });

    // Send email (logs to console for MVP)
    await sendPasswordResetEmail(user.email, token, user.name);

    return successResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
