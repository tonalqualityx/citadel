import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatDomainResponse } from '@/lib/api/formatters';

const createDomainSchema = z.object({
  name: z.string().min(1).max(255),
  site_id: z.string().uuid(),
  registrar: z.string().max(100).optional(),
  expires_at: z.string().datetime().optional().nullable(),
  is_primary: z.boolean().optional(),
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

    const where: any = {
      is_deleted: false,
      site: {
        is_deleted: false,
      },
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { registrar: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(site_id && { site_id }),
      ...(client_id && {
        site: {
          is_deleted: false,
          client_id,
        },
      }),
    };

    // Filter for domains expiring in the next 30 days
    if (expiring_soon) {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      where.expires_at = {
        lte: thirtyDaysFromNow,
        gte: new Date(),
      };
    }

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

    // Validate site exists
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

    const domain = await prisma.domain.create({
      data: {
        ...data,
        expires_at: data.expires_at ? new Date(data.expires_at) : null,
        is_primary: data.is_primary ?? false,
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
      },
    });

    return NextResponse.json(formatDomainResponse(domain), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
