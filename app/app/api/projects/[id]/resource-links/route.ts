import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const createResourceLinkSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  url: z.string().url('Invalid URL').max(500),
  icon: z.string().max(50).optional().nullable(),
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

// GET /api/projects/[id]/resource-links - List resource links for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id: projectId } = await params;

    // Verify project exists and user has access
    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
    });

    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    // Tech users can only see resource links on projects they're assigned to
    if (auth.role === 'tech') {
      const isTeamMember = await prisma.projectTeamAssignment.findFirst({
        where: {
          project_id: projectId,
          user_id: auth.userId,
        },
      });

      if (!isTeamMember) {
        throw new ApiError('Project not found', 404);
      }
    }

    // Fetch resource links ordered by sort_order
    const resourceLinks = await prisma.resourceLink.findMany({
      where: {
        project_id: projectId,
        is_deleted: false,
      },
      orderBy: { sort_order: 'asc' },
    });

    return NextResponse.json({
      resource_links: resourceLinks.map(formatResourceLinkResponse),
      count: resourceLinks.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/projects/[id]/resource-links - Create a resource link
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    const { id: projectId } = await params;
    const body = await request.json();

    const data = createResourceLinkSchema.parse(body);

    // Verify project exists and user has access
    const project = await prisma.project.findUnique({
      where: { id: projectId, is_deleted: false },
    });

    if (!project) {
      throw new ApiError('Project not found', 404);
    }

    // Only PM/Admin can manage resource links
    if (auth.role === 'tech') {
      throw new ApiError('Only PM or Admin can manage resource links', 403);
    }

    // Get the next sort_order for this project
    const lastLink = await prisma.resourceLink.findFirst({
      where: { project_id: projectId, is_deleted: false },
      orderBy: { sort_order: 'desc' },
      select: { sort_order: true },
    });

    const nextSortOrder = (lastLink?.sort_order ?? -1) + 1;

    // Create the resource link
    const resourceLink = await prisma.resourceLink.create({
      data: {
        project_id: projectId,
        name: data.name,
        url: data.url,
        icon: data.icon || null,
        sort_order: nextSortOrder,
      },
    });

    return NextResponse.json(formatResourceLinkResponse(resourceLink), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
