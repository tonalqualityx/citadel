import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { authRateLimit } from '@/lib/api/rate-limit';

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password is too long'),
});

export async function POST(request: NextRequest) {
  // Apply rate limiting
  const rateLimitResponse = authRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { token, password } = resetPasswordSchema.parse(body);

    // Find the token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: {
        user: {
          select: { id: true, is_active: true },
        },
      },
    });

    // Validate token exists
    if (!resetToken) {
      throw new ApiError('Invalid or expired reset link', 400);
    }

    // Check if token was already used
    if (resetToken.used_at) {
      throw new ApiError('This reset link has already been used', 400);
    }

    // Check if token is expired
    if (new Date() > resetToken.expires_at) {
      throw new ApiError('This reset link has expired', 400);
    }

    // Check if user is still active
    if (!resetToken.user.is_active) {
      throw new ApiError('Account is not active', 400);
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Use a transaction to update password and mark token as used
    await prisma.$transaction(async (tx) => {
      // Update user's password
      await tx.user.update({
        where: { id: resetToken.user_id },
        data: { password_hash: passwordHash },
      });

      // Mark token as used
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { used_at: new Date() },
      });

      // Invalidate all existing sessions for security
      await tx.session.deleteMany({
        where: { user_id: resetToken.user_id },
      });

      // Invalidate any other unused reset tokens for this user
      await tx.passwordResetToken.updateMany({
        where: {
          user_id: resetToken.user_id,
          used_at: null,
          id: { not: resetToken.id },
        },
        data: { used_at: new Date() },
      });
    });

    // Clear any auth cookies from the response
    const response = NextResponse.json({
      message: 'Password has been reset successfully. Please log in with your new password.',
    });

    // Clear cookies to force re-login
    response.cookies.delete('access_token');
    response.cookies.delete('refresh_token');

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
