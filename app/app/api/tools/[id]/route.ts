import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const updateToolSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.string().max(50).optional().nullable(),
  url: z.string().url().max(500).optional().nullable().or(z.literal('')),
  description: z.string().optional().nullable(),
  is_active: z.boolean().optional(),
});

function formatTool(tool: any) {
  return {
    id: tool.id,
    name: tool.name,
    category: tool.category,
    url: tool.url,
    description: tool.description,
    is_active: tool.is_active,
    created_at: tool.created_at,
    updated_at: tool.updated_at,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const tool = await prisma.tool.findUnique({
      where: { id },
    });

    if (!tool) {
      throw new ApiError('Tool not found', 404);
    }

    return NextResponse.json(formatTool(tool));
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
    requireRole(auth, ['admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateToolSchema.parse(body);

    const tool = await prisma.tool.update({
      where: { id },
      data: {
        ...data,
        url: data.url || null,
      },
    });

    return NextResponse.json(formatTool(tool));
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

    await prisma.tool.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
