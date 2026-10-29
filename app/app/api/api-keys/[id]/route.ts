import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { keyScopesSchema, humanGrantedScopesIn } from '@/lib/auth/key-scopes';
import { logDelete, logUpdate } from '@/lib/services/activity';
import { requireHumanAdminGrant } from '@/lib/auth/human-grant';

const patchSchema = z.object({ scopes: keyScopesSchema }).strict();

/**
 * PATCH /api/api-keys/:id { scopes }  (admin only)
 * Replaces a key's scopes, so a lane flips from shadow to enforce (or back) without re-minting.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;
    const { scopes } = patchSchema.parse(await request.json());
    // decisions:admin and the design:operator-* scopes are granted only by a signed-in human admin, never by an
    // API key (to itself or another key, and not even kept on a key by an API-key PATCH). Removing them is open.
    const granted = humanGrantedScopesIn(scopes);
    if (granted.length > 0) requireHumanAdminGrant(auth, granted);

    const apiKey = await prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, name: true, scopes: true, is_revoked: true, user: { select: { role: true } } },
    });
    if (!apiKey || apiKey.is_revoked) throw new ApiError('API key not found', 404);
    if (granted.length > 0 && apiKey.user?.role !== 'admin') {
      throw new ApiError(`${granted.join(', ')} can only be granted on a key for an admin user`, 400);
    }

    const updated = await prisma.apiKey.update({
      where: { id },
      data: { scopes },
      select: { id: true, name: true, key_prefix: true, user_id: true, scopes: true, updated_at: true },
    });

    await logUpdate(auth.userId, 'api_key', apiKey.id, apiKey.name, {
      scopes: { from: apiKey.scopes, to: scopes },
    });

    return NextResponse.json(updated);
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

    const apiKey = await prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, user_id: true, name: true },
    });

    if (!apiKey) {
      throw new ApiError('API key not found', 404);
    }

    // The owner may revoke their own key; an admin may revoke any key (fleet item 6: lane keys
    // live on service users, and a lost or leaked one must be revocable at once).
    if (apiKey.user_id !== auth.userId && auth.role !== 'admin') {
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
