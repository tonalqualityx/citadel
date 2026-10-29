import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { loadSessionFor } from '@/lib/design/access';
import { raiseBudget } from '@/lib/design/budget';
import { projectSession } from '@/lib/design/projections';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';

const budgetSchema = z.object({ budget_usd: z.number().finite().positive().max(100000) });

// POST /api/design/sessions/:id/budget (design 7.1): raises only; designer up to her cap, admin up to the hard cap.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    await loadSessionFor(actor, id, { mode: 'write' }); // 404/403 before the body is looked at
    const input = await body(request, budgetSchema, 4096);
    const { session } = await raiseBudget(actor, id, input.budget_usd);
    return NextResponse.json({ session: projectSession(session) });
  } catch (error) {
    return handleApiError(error);
  }
}
