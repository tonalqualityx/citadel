import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { validateKpiProposal } from '@/lib/kpis/proposal';

async function loadAccord(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError('Accord not found', 404);
  const a = await prisma.accord.findUnique({ where: { id }, select: { id: true, kpi_proposal: true } });
  if (!a) throw new ApiError('Accord not found', 404);
  return a;
}

/** GET /api/accords/:id/kpi-proposal: the stored proposal (null when none). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const a = await loadAccord(id);
    return NextResponse.json({ accord_id: a.id, kpi_proposal: a.kpi_proposal ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

/** PUT /api/accords/:id/kpi-proposal: replace the proposal. Body: { kpi_proposal: [...] } or null to clear. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const body = (await request.json()) as { kpi_proposal?: unknown };
    await loadAccord(id);
    if (body.kpi_proposal === null) {
      await prisma.accord.update({ where: { id }, data: { kpi_proposal: Prisma.DbNull } });
      return NextResponse.json({ accord_id: id, kpi_proposal: null });
    }
    const checked = validateKpiProposal(body.kpi_proposal);
    if (!checked.ok) {
      return NextResponse.json({ error: 'Invalid KPI proposal', code: 'invalid_proposal', details: checked.errors }, { status: 400 });
    }
    await prisma.accord.update({ where: { id }, data: { kpi_proposal: checked.items as unknown as Prisma.InputJsonValue } });
    return NextResponse.json({ accord_id: id, kpi_proposal: checked.items });
  } catch (error) {
    return handleApiError(error);
  }
}
