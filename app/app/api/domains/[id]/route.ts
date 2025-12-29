import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatDomainResponse } from '@/lib/api/formatters';

const updateDomainSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  registrar: z.string().max(100).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
  is_primary: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const domain = await prisma.domain.findUnique({
      where: { id, is_deleted: false },
      include: {
        site: {
          select: {
            id: true,
            name: true,
            url: true,
            client: {
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
    });

    if (!domain) {
      throw new ApiError('Domain not found', 404);
    }

    return NextResponse.json(formatDomainResponse(domain));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateDomainSchema.parse(body);

    // Get current domain to check site_id for primary handling
    const currentDomain = await prisma.domain.findUnique({
      where: { id },
      select: { site_id: true },
    });

    if (!currentDomain) {
      throw new ApiError('Domain not found', 404);
    }

    // If this domain is being set as primary, unset other primary domains for this site
    if (data.is_primary) {
      await prisma.domain.updateMany({
        where: {
          site_id: currentDomain.site_id,
          is_primary: true,
          id: { not: id },
        },
        data: { is_primary: false },
      });
    }

    const domain = await prisma.domain.update({
      where: { id },
      data: {
        ...data,
        expires_at: data.expires_at !== undefined
          ? (data.expires_at ? new Date(data.expires_at) : null)
          : undefined,
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

    return NextResponse.json(formatDomainResponse(domain));
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
    requireRole(auth, ['admin']);
    const { id } = await params;

    // Soft delete
    await prisma.domain.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
