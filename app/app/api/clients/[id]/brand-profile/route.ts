import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatBrandProfileResponse } from '@/lib/api/formatters';
import { brandProfileInputSchema, buildBrandProfileData } from '@/lib/api/brand-profile';
import { logCreate, logUpdate } from '@/lib/services/activity';

// GET /api/clients/[id]/brand-profile — the client's brand profile (or null if none yet)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const client = await prisma.client.findUnique({
      where: { id, is_deleted: false },
      select: { id: true },
    });
    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    const profile = await prisma.brandProfile.findFirst({
      where: { client_id: id, is_deleted: false },
    });

    return NextResponse.json({ profile: formatBrandProfileResponse(profile) });
  } catch (error) {
    return handleApiError(error);
  }
}

// PUT /api/clients/[id]/brand-profile — upsert the client's brand profile (create or update)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const client = await prisma.client.findUnique({
      where: { id, is_deleted: false },
      select: { id: true, name: true },
    });
    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    const body = await request.json();
    const input = brandProfileInputSchema.parse(body);
    const data = buildBrandProfileData(input);

    const existing = await prisma.brandProfile.findFirst({
      where: { client_id: id, is_deleted: false },
      select: { id: true },
    });

    let profile;
    if (existing) {
      profile = await prisma.brandProfile.update({ where: { id: existing.id }, data });
      await logUpdate(auth.userId, 'brand_profile', profile.id, `${client.name} brand`, {
        fields: { from: null, to: Object.keys(data) },
      });
    } else {
      profile = await prisma.brandProfile.create({ data: { ...data, client_id: id } });
      await logCreate(auth.userId, 'brand_profile', profile.id, `${client.name} brand`);
    }

    return NextResponse.json({ profile: formatBrandProfileResponse(profile) });
  } catch (error) {
    return handleApiError(error);
  }
}
