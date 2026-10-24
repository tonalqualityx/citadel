import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { ChecklistError, ITEM_STATES, serializeChecklist, setItemState } from '@/lib/checklists/service';
import { checklistErrorResponse } from '@/lib/checklists/http';

const patchSchema = z.object({
  state: z.enum(ITEM_STATES),
  evidence: z.string().max(5000).nullable().optional(),
});

/**
 * PATCH /api/checklists/:id/items/:key: set an item's state, with evidence. Verified and waived
 * need evidence. The signed-in staff user is recorded as the verifier. Returns the whole checklist.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; key: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id, key } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError('Checklist not found', 404);
    const body = patchSchema.parse(await request.json());
    try {
      const checklist = await setItemState(prisma, id, decodeURIComponent(key), {
        state: body.state,
        evidence: body.evidence ?? null,
        verified_by_id: auth.userId,
      });
      return NextResponse.json(serializeChecklist(checklist));
    } catch (e) {
      if (e instanceof ChecklistError) return checklistErrorResponse(e);
      throw e;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
