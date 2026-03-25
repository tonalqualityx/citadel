import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatMsaVersionResponse } from '@/lib/api/formatters';

// GET /api/msa/:id - Get MSA version detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id } = await params;

    const msaVersion = await prisma.msaVersion.findUnique({
      where: { id },
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
    });

    if (!msaVersion) {
      return NextResponse.json({ error: 'MSA version not found' }, { status: 404 });
    }

    return NextResponse.json(formatMsaVersionResponse(msaVersion));
  } catch (error) {
    return handleApiError(error);
  }
}

const updateMsaSchema = z.object({
  version: z.string().min(1).max(20).optional(),
  content: z.string().min(1).optional(),
  effective_date: z.string().optional(),
  is_current: z.boolean().optional(),
  change_summary: z.string().nullable().optional(),
});

// PATCH /api/msa/:id - Update MSA version
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['admin']);
    const { id } = await params;
    const body = await request.json();
    const data = updateMsaSchema.parse(body);

    const existing = await prisma.msaVersion.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'MSA version not found' }, { status: 404 });
    }

    // If setting as current, unset all others
    if (data.is_current === true) {
      await prisma.msaVersion.updateMany({
        where: { is_current: true, id: { not: id } },
        data: { is_current: false },
      });
    }

    const msaVersion = await prisma.msaVersion.update({
      where: { id },
      data: {
        ...(data.version !== undefined && { version: data.version }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.effective_date !== undefined && { effective_date: new Date(data.effective_date) }),
        ...(data.is_current !== undefined && { is_current: data.is_current }),
        ...(data.change_summary !== undefined && { change_summary: data.change_summary }),
      },
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
    });

    return NextResponse.json(formatMsaVersionResponse(msaVersion));
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/msa/:id - Delete MSA version (only if no signatures)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['admin']);
    const { id } = await params;

    const existing = await prisma.msaVersion.findUnique({
      where: { id },
      include: { _count: { select: { client_msa_signatures: true, contracts: true } } },
    });

    if (!existing) {
      return NextResponse.json({ error: 'MSA version not found' }, { status: 404 });
    }

    if (existing._count.client_msa_signatures > 0 || existing._count.contracts > 0) {
      return NextResponse.json(
        { error: 'Cannot delete MSA version with existing signatures or contracts' },
        { status: 400 }
      );
    }

    await prisma.msaVersion.delete({ where: { id } });

    return NextResponse.json({ message: 'MSA version deleted' });
  } catch (error) {
    return handleApiError(error);
  }
}
