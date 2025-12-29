import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const createToolSchema = z.object({
  name: z.string().min(1).max(100),
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
    license_key: tool.license_key,
    is_active: tool.is_active,
    created_at: tool.created_at,
    updated_at: tool.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('include_inactive') === 'true';
    const category = searchParams.get('category') || undefined;

    const where = {
      ...(includeInactive ? {} : { is_active: true }),
      ...(category && { category }),
    };

    const tools = await prisma.tool.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    // Get unique categories for filtering
    const categories = await prisma.tool.findMany({
      where: includeInactive ? {} : { is_active: true },
      select: { category: true },
      distinct: ['category'],
    });

    return NextResponse.json({
      tools: tools.map(formatTool),
      categories: categories.map((c) => c.category).filter(Boolean),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const data = createToolSchema.parse(body);

    const tool = await prisma.tool.create({
      data: {
        name: data.name,
        category: data.category,
        url: data.url || null,
        description: data.description,
        is_active: data.is_active ?? true,
      },
    });

    return NextResponse.json(formatTool(tool), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
