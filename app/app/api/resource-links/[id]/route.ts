import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const updateResourceLinkSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url('Invalid URL').max(500).optional(),
  icon: z.string().max(50).optional().nullable(),
  sort_order: z.number().int().min(0).optional(),
});

function formatResourceLinkResponse(link: any) {
  return {
    id: link.id,
    project_id: link.project_id,
    name: link.name,
    url: link.url,
    icon: link.icon,
    sort_order: link.sort_order,
    created_at: link.created_at.toISOString(),
    updated_at: link.updated_at.toISOString(),
  };
}

// GET /api/resource-links/[id] - Get a single resource link
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const resourceLink = await prisma.resourceLink.findUnique({
      where: { id, is_deleted: false },
    });

    if (!resourceLink) {
      throw new ApiError('Resource link not found', 404);
    }

    return NextResponse.json(formatResourceLinkResponse(resourceLink));
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/resource-links/[id] - Update a resource link
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const body = await request.json();

    // Only PM/Admin can manage resource links
    if (auth.role === 'tech') {
      throw new ApiError('Only PM or Admin can manage resource links', 403);
    }

    const data = updateResourceLinkSchema.parse(body);

    // Verify resource link exists
    const existing = await prisma.resourceLink.findUnique({
      where: { id, is_deleted: false },
    });

    if (!existing) {
      throw new ApiError('Resource link not found', 404);
    }

    // Update the resource link
    const resourceLink = await prisma.resourceLink.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.url !== undefined && { url: data.url }),
        ...(data.icon !== undefined && { icon: data.icon }),
        ...(data.sort_order !== undefined && { sort_order: data.sort_order }),
      },
    });

    return NextResponse.json(formatResourceLinkResponse(resourceLink));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/resource-links/[id] - Soft delete a resource link
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;

    // Only PM/Admin can manage resource links
    if (auth.role === 'tech') {
      throw new ApiError('Only PM or Admin can manage resource links', 403);
    }

    // Verify resource link exists
    const existing = await prisma.resourceLink.findUnique({
      where: { id, is_deleted: false },
    });

    if (!existing) {
      throw new ApiError('Resource link not found', 404);
    }

    // Soft delete
    await prisma.resourceLink.update({
      where: { id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
