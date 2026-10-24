import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { confirmKpiProposal, KpiConfirmError } from '@/lib/kpis/confirm';

/**
 * POST /api/accords/:id/kpis/confirm: confirm the accord's KPI proposal into SiteKpi rows.
 * Idempotent: a repeat creates nothing and answers 200 with zero created. Nothing calls this
 * from the signing route today.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Accord not found', 404);
    try {
      const result = await confirmKpiProposal(prisma, id);
      return NextResponse.json(result, { status: result.created > 0 ? 201 : 200 });
    } catch (e) {
      if (e instanceof KpiConfirmError) {
        const status = e.code === 'accord_not_found' ? 404 : 409;
        return NextResponse.json({ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) }, { status });
      }
      throw e;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
