import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatDomainResponse } from '@/lib/api/formatters';

const createDomainSchema = z.object({
  name: z.string().min(1).max(255),
  site_id: z.string().uuid().optional().nullable(), // Optional - domain can exist without a site
  registrar: z.string().max(100).optional(),
  expires_at: z.string().datetime().optional().nullable(),
  is_primary: z.boolean().optional(),
  // Ownership & DNS
  registered_by: z.enum(['indelible', 'client']).optional().nullable(),
  dns_provider_id: z.string().uuid().optional().nullable(),
  dns_managed_by: z.enum(['indelible', 'client']).optional().nullable(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const site_id = searchParams.get('site_id') || undefined;
    const client_id = searchParams.get('client_id') || undefined;
    const expiring_soon = searchParams.get('expiring_soon') === 'true';
    const unassigned = searchParams.get('unassigned') === 'true';

    // Build where conditions array
    const conditions: any[] = [{ is_deleted: false }];

    // Search filter
    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { registrar: { contains: search, mode: 'insensitive' as const } },
        ],
      });
    }

    // Filter by specific site
    if (site_id) {
      conditions.push({ site_id });
    }

    // Filter for unassigned domains only
    if (unassigned) {
      conditions.push({ site_id: null });
    }

    // Filter by client (only works for domains with sites)
    if (client_id) {
      conditions.push({
        site: {
          is_deleted: false,
          client_id,
        },
      });
    }

    // For general listing, exclude domains linked to deleted sites
    if (!site_id && !unassigned && !client_id) {
      conditions.push({
        OR: [
          { site_id: null },
          { site: { is_deleted: false } },
        ],
      });
    }

    // Filter for domains expiring in the next 30 days
    if (expiring_soon) {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      conditions.push({
        expires_at: {
          lte: thirtyDaysFromNow,
          gte: new Date(),
        },
      });
    }

    const where = { AND: conditions };

    const [domains, total] = await Promise.all([
      prisma.domain.findMany({
        where,
        include: {
          site: {
            select: {
              id: true,
              name: true,
              client: {
                select: { id: true, name: true },
              },
            },
          },
          dns_provider: {
            select: { id: true, name: true },
          },
        },
        orderBy: [{ is_primary: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.domain.count({ where }),
    ]);

    return NextResponse.json({
      domains: domains.map(formatDomainResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createDomainSchema.parse(body);

    // Validate site exists if provided
    if (data.site_id) {
      const site = await prisma.site.findUnique({
        where: { id: data.site_id, is_deleted: false },
      });
      if (!site) {
        throw new ApiError('Site not found', 404);
      }

      // If this domain is marked as primary, unset other primary domains for this site
      if (data.is_primary) {
        await prisma.domain.updateMany({
          where: { site_id: data.site_id, is_primary: true },
          data: { is_primary: false },
        });
      }
    }

    const domain = await prisma.domain.create({
      data: {
        name: data.name,
        site_id: data.site_id || null,
        registrar: data.registrar,
        expires_at: data.expires_at ? new Date(data.expires_at) : null,
        is_primary: data.site_id ? (data.is_primary ?? false) : false, // Only primary if linked to a site
        registered_by: data.registered_by,
        dns_provider_id: data.dns_provider_id,
        dns_managed_by: data.dns_managed_by,
        notes: data.notes,
      },
      include: {
        site: {
          select: {
            id: true,
            name: true,
            client: {
              select: { id: true, name: true },
            },
          },
        },
        dns_provider: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json(formatDomainResponse(domain), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
