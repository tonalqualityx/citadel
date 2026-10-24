import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { serializeSiteKpi } from '@/lib/kpis/serialize';
import { KPI_DIRECTIONS, KPI_SOURCES } from '@/lib/kpis/proposal';
import { assertLinksBelongToClient } from '@/lib/kpis/links';

const STATUSES = ['proposed', 'confirmed', 'retired'] as const;
const uuid = z.string().uuid();
const DEC = z.number().finite().min(-999_999_999_999.99).max(999_999_999_999.99);

const createSchema = z.object({
  client_id: uuid,
  site_id: uuid.nullable().optional(),
  accord_id: uuid.nullable().optional(),
  charter_id: uuid.nullable().optional(),
  metric: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(200),
  direction: z.enum(KPI_DIRECTIONS),
  baseline_value: DEC.nullable().optional(),
  baseline_at: z.string().datetime({ offset: true }).nullable().optional(),
  target_value: DEC.nullable().optional(),
  target_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  source: z.enum(KPI_SOURCES),
  status: z.enum(['proposed', 'confirmed']).optional(),
});

/** GET /api/site-kpis?client_id= or ?site_id=: list KPI rows (retired ones only with status=retired or all). */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const sp = new URL(request.url).searchParams;
    const clientId = sp.get('client_id');
    const siteId = sp.get('site_id');
    const status = sp.get('status');
    if (!clientId && !siteId) throw new ApiError('Give client_id or site_id', 400);
    if (clientId && !uuid.safeParse(clientId).success) throw new ApiError('client_id must be a uuid', 400);
    if (siteId && !uuid.safeParse(siteId).success) throw new ApiError('site_id must be a uuid', 400);
    if (status && status !== 'all' && !(STATUSES as readonly string[]).includes(status)) throw new ApiError('Unknown status', 400);

    const rows = await prisma.siteKpi.findMany({
      where: {
        ...(clientId ? { client_id: clientId } : {}),
        ...(siteId ? { site_id: siteId } : {}),
        // Default: everything except retired.
        ...(status === 'all' ? {} : status ? { status } : { status: { not: 'retired' } }),
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return NextResponse.json({ data: rows.map(serializeSiteKpi), meta: { count: rows.length } });
  } catch (error) {
    return handleApiError(error);
  }
}

/** POST /api/site-kpis: create one KPI row (proposed by default; confirmed when asked). */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const body = createSchema.parse(await request.json());
    await assertLinksBelongToClient(body.client_id, body);
    const status = body.status ?? 'proposed';
    const row = await prisma.siteKpi.create({
      data: {
        client_id: body.client_id,
        site_id: body.site_id ?? null,
        accord_id: body.accord_id ?? null,
        charter_id: body.charter_id ?? null,
        metric: body.metric,
        label: body.label,
        direction: body.direction,
        baseline_value: body.baseline_value ?? null,
        baseline_at: body.baseline_at ? new Date(body.baseline_at) : null,
        target_value: body.target_value ?? null,
        target_by: body.target_by ? new Date(`${body.target_by}T00:00:00Z`) : null,
        source: body.source,
        status,
        confirmed_at: status === 'confirmed' ? new Date() : null,
      },
    });
    return NextResponse.json(serializeSiteKpi(row), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
