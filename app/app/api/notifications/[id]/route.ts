import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, notFound } from '@/lib/api/errors';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    // Verify notification belongs to user
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { user_id: true },
    });

    if (!notification) {
      return notFound('Notification not found');
    }

    if (notification.user_id !== auth.userId) {
      return notFound('Notification not found');
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: {
        is_read: true,
        read_at: new Date(),
      },
    });

    return NextResponse.json({
      notification: {
        id: updated.id,
        type: updated.type,
        title: updated.title,
        message: updated.message,
        entity_type: updated.entity_type,
        entity_id: updated.entity_id,
        is_read: updated.is_read,
        read_at: updated.read_at?.toISOString() || null,
        bundle_count: updated.bundle_count,
        created_at: updated.created_at.toISOString(),
      },
    });
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
    const { id } = await params;

    // Verify notification belongs to user
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { user_id: true },
    });

    if (!notification) {
      return notFound('Notification not found');
    }

    if (notification.user_id !== auth.userId) {
      return notFound('Notification not found');
    }

    await prisma.notification.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
