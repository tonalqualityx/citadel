import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const updateUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255).optional(),
  email: z.string().email('Invalid email address').max(255).optional(),
  role: z.enum(['tech', 'pm', 'admin']).optional(),
  avatar_url: z.string().url().max(500).optional().nullable(),
  is_active: z.boolean().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        is_active: true,
        avatar_url: true,
        last_login_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    const body = await request.json();

    // Check if this is a password reset request
    if (body.password !== undefined) {
      const { password } = resetPasswordSchema.parse(body);
      const passwordHash = await bcrypt.hash(password, 12);

      const user = await prisma.user.update({
        where: { id },
        data: { password_hash: passwordHash },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          is_active: true,
          avatar_url: true,
        },
      });

      // Invalidate all sessions for the user
      await prisma.session.deleteMany({
        where: { user_id: id },
      });

      return NextResponse.json(user);
    }

    // Regular update
    const data = updateUserSchema.parse(body);

    // If email is being changed, check for uniqueness
    if (data.email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email: data.email,
          id: { not: id },
        },
      });

      if (existingUser) {
        throw new ApiError('A user with this email already exists', 400);
      }
    }

    // Prevent admin from deactivating themselves
    if (data.is_active === false && id === auth.userId) {
      throw new ApiError('You cannot deactivate your own account', 400);
    }

    // Prevent admin from changing their own role
    if (data.role && id === auth.userId) {
      throw new ApiError('You cannot change your own role', 400);
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        is_active: true,
        avatar_url: true,
        last_login_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    return NextResponse.json(user);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    // Prevent admin from deleting themselves
    if (id === auth.userId) {
      throw new ApiError('You cannot delete your own account', 400);
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // Check if user has any assigned tasks, time entries, etc.
    const relatedRecords = await prisma.task.count({
      where: { assignee_id: id, is_deleted: false },
    });

    if (relatedRecords > 0) {
      // Soft delete - just deactivate
      await prisma.user.update({
        where: { id },
        data: { is_active: false },
      });

      return NextResponse.json({
        message: 'User has been deactivated (has related records)',
        deactivated: true,
      });
    }

    // Hard delete if no related records
    await prisma.user.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
