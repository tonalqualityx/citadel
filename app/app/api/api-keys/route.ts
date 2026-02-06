import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { generateApiKey } from '@/lib/auth/api-keys';
import { logCreate } from '@/lib/services/activity';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  expires_at: z.string().datetime().optional(),
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

    const { rawKey, keyHash, keyPrefix } = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        user_id: auth.userId,
        name: data.name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        expires_at: data.expires_at ? new Date(data.expires_at) : null,
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
        created_at: apiKey.created_at,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
