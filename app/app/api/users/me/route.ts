import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  avatar_url: z.string().max(500).nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar_url: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
        preferences: {
          select: {
            naming_convention: true,
            theme: true,
            notification_bundle: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        is_active: user.is_active,
        last_login_at: user.last_login_at?.toISOString() || null,
        created_at: user.created_at.toISOString(),
        preferences: user.preferences || {
          naming_convention: 'awesome',
          theme: 'system',
          notification_bundle: true,
        },
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await request.json();
    const data = updateProfileSchema.parse(body);

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.avatar_url !== undefined) updateData.avatar_url = data.avatar_url;

    const user = await prisma.user.update({
      where: { id: auth.userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar_url: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
        preferences: {
          select: {
            naming_convention: true,
            theme: true,
            notification_bundle: true,
          },
        },
      },
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        is_active: user.is_active,
        last_login_at: user.last_login_at?.toISOString() || null,
        created_at: user.created_at.toISOString(),
        preferences: user.preferences || {
          naming_convention: 'awesome',
          theme: 'system',
          notification_bundle: true,
        },
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
