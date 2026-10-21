import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess } from '@/lib/portal/access';
import { fileRequest } from '@/lib/portal/intake/file-request';
import { INTAKE_TYPES } from '@/lib/portal/intake/tree';
import { loadRequests, MAX_CLOSED_DAYS } from '@/lib/portal/requests';

const bodySchema = z.object({
  intake_id: z.string().uuid(),
  type: z.enum(INTAKE_TYPES),
  site_id: z.string().uuid().nullish(),
  project_id: z.string().uuid().nullish(),
  chosen_project_id: z.string().uuid().nullish(),
  answers: z
    .array(
      z.object({
        key: z.string().min(1).max(10),
        value: z.string().max(2000),
        detail: z.string().max(2000).optional(),
      })
    )
    .max(5),
});

// POST /api/portal/requests (portal phase B slice 1)
// File a request as one Citadel task. 201 with the task when new; 200 with the same task when the
// intake_id was already filed (nothing changes). Out of scope ids return 404, never 403.
export async function POST(request: NextRequest) {
  try {
    // Per-IP guard on top of the per-person database limits, the same as the GETs.
    const limited = rateLimit(request, 120);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const body = bodySchema.parse(await request.json());

    const contact = await prisma.clientContact.findFirst({
      where: { id: access.contactId, is_deleted: false },
      select: { id: true, name: true },
    });
    const filed = await fileRequest(access, { id: access.contactId, name: contact?.name ?? null }, body);
    return NextResponse.json({ task: filed.task, urgent: filed.urgent }, { status: filed.created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

// GET /api/portal/requests?site_id=&closed_days=30
// Open requests (attention first, then newest) and what closed recently, in client words.
export async function GET(request: NextRequest) {
  try {
    const limited = rateLimit(request, 120);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const sp = new URL(request.url).searchParams;
    const siteId = z.string().uuid().safeParse(sp.get('site_id'));
    const days = Number(sp.get('closed_days'));
    const { open, recently_closed } = await loadRequests(access, {
      site_id: siteId.success ? siteId.data : null,
      closed_days: Number.isFinite(days) && days > 0 ? Math.min(days, MAX_CLOSED_DAYS) : undefined,
    });
    return NextResponse.json({ open, recently_closed });
  } catch (error) {
    return handleApiError(error);
  }
}
