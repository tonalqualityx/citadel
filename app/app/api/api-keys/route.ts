import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { generateApiKey } from '@/lib/auth/api-keys';
import { keyScopesSchema } from '@/lib/auth/key-scopes';
import { logCreate } from '@/lib/services/activity';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expires_at: z.string().datetime().optional(),
  // engine | lane:<name> | scope-mode:enforce (lib/auth/key-scopes.ts). Admin only.
  scopes: keyScopesSchema.optional(),
  // Admin only: mint the key for a service user (Bast, Oracle, Troubador) instead of the caller.
  user_id: z.string().uuid().optional(),
});

export async function GET() {
  try {
    const auth = await requireAuth();

    const keys = await prisma.apiKey.findMany({
      where: {
        user_id: auth.userId,
        is_revoked: false,
      },
      select: {
        id: true,
        name: true,
        key_prefix: true,
        last_used_at: true,
        expires_at: true,
        scopes: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });

    return NextResponse.json({ api_keys: keys });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();

    const body = await request.json();
    const data = createApiKeySchema.parse(body);
    if (data.scopes && data.scopes.length > 0) requireRole(auth, ['admin']);
    if (data.user_id !== undefined) requireRole(auth, ['admin']);

    let ownerId = auth.userId;
    if (data.user_id !== undefined && data.user_id !== auth.userId) {
      const owner = await prisma.user.findUnique({
        where: { id: data.user_id },
        select: { id: true, is_active: true },
      });
      if (!owner || !owner.is_active) throw new ApiError('User not found or inactive', 404);
      ownerId = owner.id;
    }

    const { rawKey, keyHash, keyPrefix } = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        user_id: ownerId,
        name: data.name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        expires_at: data.expires_at ? new Date(data.expires_at) : null,
        scopes: data.scopes ?? [],
      },
    });

    await logCreate(auth.userId, 'api_key', apiKey.id, data.name);

    return NextResponse.json(
      {
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey,
        key_prefix: apiKey.key_prefix,
        expires_at: apiKey.expires_at,
        scopes: apiKey.scopes ?? [],
        user_id: ownerId,
        created_at: apiKey.created_at,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
