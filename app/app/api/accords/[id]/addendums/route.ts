import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAddendumResponse } from '@/lib/api/formatters';

const createAddendumSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  contract_content: z.string().min(1),
  changes: z.record(z.string(), z.unknown()),
  pricing_snapshot: z.record(z.string(), z.unknown()),
  is_override: z.boolean().optional(),
  override_reason: z.string().optional(),
});

// GET /api/accords/:id/addendums - List addendums for an accord
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    // Verify accord exists
    const accord = await prisma.accord.findUnique({
      where: { id, is_deleted: false },
    });

    if (!accord) {
      throw new ApiError('Accord not found', 404);
    }

    const addendums = await prisma.addendum.findMany({
      where: {
        accord_id: id,
        is_deleted: false,
      },
      include: {
        created_by: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { version: 'desc' },
    });

    return NextResponse.json({
      addendums: addendums.map(formatAddendumResponse),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/accords/:id/addendums - Create a new addendum
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    // Verify accord exists
    const accord = await prisma.accord.findUnique({
      where: { id, is_deleted: false },
    });

    if (!accord) {
      throw new ApiError('Accord not found', 404);
    }

    const body = await request.json();
    const data = createAddendumSchema.parse(body);

    // Auto-increment version
    const latestAddendum = await prisma.addendum.findFirst({
      where: { accord_id: id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latestAddendum?.version ?? 0) + 1;

    const addendum = await prisma.addendum.create({
      data: {
        accord_id: id,
        version: nextVersion,
        title: data.title,
        description: data.description,
        contract_content: data.contract_content,
        changes: data.changes as any,
        pricing_snapshot: data.pricing_snapshot as any,
        is_override: data.is_override ?? false,
        override_reason: data.override_reason ?? null,
        created_by_id: auth.userId,
      },
      include: {
        created_by: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(formatAddendumResponse(addendum), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
