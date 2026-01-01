import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatDomainResponse } from '@/lib/api/formatters';

const updateDomainSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  site_id: z.string().uuid().optional().nullable(), // Can link/unlink from sites
  registrar: z.string().max(100).optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
  is_primary: z.boolean().optional(),
  // Ownership & DNS
  registered_by: z.enum(['indelible', 'client']).optional().nullable(),
  dns_provider_id: z.string().uuid().optional().nullable(),
  dns_managed_by: z.enum(['indelible', 'client']).optional().nullable(),
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
        dns_provider: {
          select: { id: true, name: true },
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
      select: { site_id: true, is_primary: true },
    });

    if (!currentDomain) {
      throw new ApiError('Domain not found', 404);
    }

    // Validate new site exists if being linked
    if (data.site_id) {
      const site = await prisma.site.findUnique({
        where: { id: data.site_id, is_deleted: false },
      });
      if (!site) {
        throw new ApiError('Site not found', 404);
      }
    }

    // Determine the effective site_id for primary handling
    const effectiveSiteId = data.site_id !== undefined ? data.site_id : currentDomain.site_id;

    // If this domain is being set as primary and has a site, unset other primary domains
    if (data.is_primary && effectiveSiteId) {
      await prisma.domain.updateMany({
        where: {
          site_id: effectiveSiteId,
          is_primary: true,
          id: { not: id },
        },
        data: { is_primary: false },
      });
    }

    // Build update data
    const updateData: any = {
      name: data.name,
      registrar: data.registrar,
      expires_at: data.expires_at !== undefined
        ? (data.expires_at ? new Date(data.expires_at) : null)
        : undefined,
      registered_by: data.registered_by,
      dns_provider_id: data.dns_provider_id,
      dns_managed_by: data.dns_managed_by,
      notes: data.notes,
    };

    // Handle site_id changes
    if (data.site_id !== undefined) {
      updateData.site_id = data.site_id;
      // If unlinking from site (site_id = null), reset is_primary
      if (data.site_id === null) {
        updateData.is_primary = false;
      }
    }

    // Handle is_primary (only if domain has/will have a site)
    if (data.is_primary !== undefined && effectiveSiteId) {
      updateData.is_primary = data.is_primary;
    }

    const domain = await prisma.domain.update({
      where: { id },
      data: updateData,
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
