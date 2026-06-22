import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatBrandProfileResponse } from '@/lib/api/formatters';
import { brandProfileInputSchema, buildBrandProfileData } from '@/lib/api/brand-profile';
import { resolveBrandProfile } from '@/lib/calculations/brand-profile';
import { logCreate, logUpdate } from '@/lib/services/activity';

// Build the { profile, inherited, resolved } payload for a site: its own profile, the owning
// client's profile (inherited), and the per-field cascade the voice/design gates read.
async function buildSitePayload(siteId: string, clientId: string | null) {
  const [ownRow, clientRow] = await Promise.all([
    prisma.brandProfile.findFirst({ where: { site_id: siteId, is_deleted: false } }),
    clientId
      ? prisma.brandProfile.findFirst({ where: { client_id: clientId, is_deleted: false } })
      : Promise.resolve(null),
  ]);

  const own = formatBrandProfileResponse(ownRow);
  const inherited = formatBrandProfileResponse(clientRow);

  return {
    profile: own,
    inherited,
    resolved: resolveBrandProfile(own, inherited),
  };
}

// GET /api/sites/[id]/brand-profile — the site's own profile + inherited client profile + resolved
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const site = await prisma.site.findUnique({
      where: { id, is_deleted: false },
      select: { id: true, client_id: true },
    });
    if (!site) {
      throw new ApiError('Site not found', 404);
    }

    return NextResponse.json(await buildSitePayload(site.id, site.client_id));
  } catch (error) {
    return handleApiError(error);
  }
}

// PUT /api/sites/[id]/brand-profile — upsert the site's own profile (overrides cascade per-field)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const site = await prisma.site.findUnique({
      where: { id, is_deleted: false },
      select: { id: true, name: true, client_id: true },
    });
    if (!site) {
      throw new ApiError('Site not found', 404);
    }

    const body = await request.json();
    const input = brandProfileInputSchema.parse(body);
    const data = buildBrandProfileData(input);

    const existing = await prisma.brandProfile.findFirst({
      where: { site_id: id, is_deleted: false },
      select: { id: true },
    });

    if (existing) {
      const updated = await prisma.brandProfile.update({ where: { id: existing.id }, data });
      await logUpdate(auth.userId, 'brand_profile', updated.id, `${site.name} brand`, {
        fields: { from: null, to: Object.keys(data) },
      });
    } else {
      const created = await prisma.brandProfile.create({ data: { ...data, site_id: id } });
      await logCreate(auth.userId, 'brand_profile', created.id, `${site.name} brand`);
    }

    return NextResponse.json(await buildSitePayload(site.id, site.client_id));
  } catch (error) {
    return handleApiError(error);
  }
}
