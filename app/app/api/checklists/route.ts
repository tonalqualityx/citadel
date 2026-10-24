import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { ChecklistError, createChecklistFromTemplate, serializeChecklist } from '@/lib/checklists/service';
import { checklistErrorResponse } from '@/lib/checklists/http';

const uuid = z.string().uuid();
const createSchema = z.object({
  kind: z.enum(['onboarding', 'offboarding', 'takeover']),
  client_id: uuid,
  template: z.string().min(1).max(80),
  accord_id: uuid.nullable().optional(),
  charter_id: uuid.nullable().optional(),
  project_id: uuid.nullable().optional(),
});

/** GET /api/checklists?client_id=: a client's checklists, newest first. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const clientId = new URL(request.url).searchParams.get('client_id');
    if (!clientId || !uuid.safeParse(clientId).success) throw new ApiError('Give client_id (a uuid)', 400);
    const rows = await prisma.checklist.findMany({
      where: { client_id: clientId },
      include: { items: { orderBy: { key: 'asc' } } },
      orderBy: { started_at: 'desc' },
      take: 50,
    });
    return NextResponse.json({ data: rows.map(serializeChecklist), meta: { count: rows.length } });
  } catch (error) {
    return handleApiError(error);
  }
}

/** POST /api/checklists: create from a template. 201 when new, 200 when the open one already exists. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const body = createSchema.parse(await request.json());
    try {
      const { checklist, created } = await createChecklistFromTemplate(prisma, body);
      return NextResponse.json(serializeChecklist(checklist), { status: created ? 201 : 200 });
    } catch (e) {
      if (e instanceof ChecklistError) return checklistErrorResponse(e);
      throw e;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
