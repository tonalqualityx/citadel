import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatContractResponse } from '@/lib/api/formatters';

// GET /api/accords/:id/contracts/:contractId - Get contract detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contractId: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId, contractId } = await params;

    const contract = await prisma.contract.findFirst({
      where: {
        id: contractId,
        accord_id: accordId,
        is_deleted: false,
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        msa_version: { select: { id: true, version: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });

    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    return NextResponse.json(formatContractResponse(contract));
  } catch (error) {
    return handleApiError(error);
  }
}

const updateContractSchema = z.object({
  content: z.string().optional(),
});

// PATCH /api/accords/:id/contracts/:contractId - Update draft contract
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contractId: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId, contractId } = await params;
    const body = await request.json();
    const data = updateContractSchema.parse(body);

    const existing = await prisma.contract.findFirst({
      where: {
        id: contractId,
        accord_id: accordId,
        is_deleted: false,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      throw new ApiError('Only draft contracts can be edited', 400);
    }

    const contract = await prisma.contract.update({
      where: { id: contractId },
      data: {
        ...(data.content !== undefined && { content: data.content }),
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        msa_version: { select: { id: true, version: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json(formatContractResponse(contract));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/accords/:id/contracts/:contractId - Soft delete contract
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; contractId: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId, contractId } = await params;

    const existing = await prisma.contract.findFirst({
      where: {
        id: contractId,
        accord_id: accordId,
        is_deleted: false,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    await prisma.contract.update({
      where: { id: contractId },
      data: { is_deleted: true },
    });

    return NextResponse.json({ message: 'Contract deleted' });
  } catch (error) {
    return handleApiError(error);
  }
}
