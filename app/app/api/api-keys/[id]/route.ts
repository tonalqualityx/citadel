import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logDelete } from '@/lib/services/activity';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    const apiKey = await prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, user_id: true, name: true },
    });

    if (!apiKey) {
      throw new ApiError('API key not found', 404);
    }

    if (apiKey.user_id !== auth.userId) {
      throw new ApiError('Not authorized to revoke this key', 403);
    }

    await prisma.apiKey.update({
      where: { id },
      data: { is_revoked: true },
    });

    await logDelete(auth.userId, 'api_key', apiKey.id, apiKey.name);

    return NextResponse.json({ message: 'API key revoked' });
  } catch (error) {
    return handleApiError(error);
  }
}
