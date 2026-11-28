import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatRecurringWorkResponse } from '@/lib/api/formatters';
import {
  KIND_VALUES,
  RECURRING_WORK_INCLUDE,
  assertKindFields,
  assertLinksExist,
  assertNoCopyOfCharter,
  convertUsageFields,
  groupRecurringWork,
  isStopped,
  recurringWorkCreateSchema,
} from '@/lib/recurring-work/service';

const listQuerySchema = z.object({
  kind: z.enum(KIND_VALUES).optional(),
  client_id: z.string().uuid().optional(),
  charter_id: z.string().uuid().optional(),
  initiative_id: z.string().uuid().optional(),
  owner_id: z.string().uuid().optional(),
  is_active: z.enum(['true', 'false']).optional(),
  include_plumbing: z.enum(['true', 'false']).optional(),
  grouped: z.enum(['true', 'false']).optional(),
});

// GET /api/recurring-work - list; background plumbing is hidden unless ?include_plumbing=true
export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const q = listQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const rows = await prisma.recurringWork.findMany({
      where: {
        ...(q.kind ? { kind: q.kind } : {}),
        // a charter row's client is its charter's
        ...(q.client_id ? { OR: [{ charter_id: null, client_id: q.client_id }, { charter: { client_id: q.client_id } }] } : {}),
        ...(q.charter_id ? { charter_id: q.charter_id } : {}),
        ...(q.initiative_id ? { initiative_id: q.initiative_id } : {}),
        ...(q.owner_id ? { owner_id: q.owner_id } : {}),
        // the grouped view is Mike's short list, so it shows active rows unless is_active says otherwise
        ...(q.is_active ? { is_active: q.is_active === 'true' } : q.grouped === 'true' ? { is_active: true } : {}),
        ...(q.include_plumbing === 'true' ? {} : { is_plumbing: false }),
      },
      include: RECURRING_WORK_INCLUDE,
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });
    const formatted = rows.map(formatRecurringWorkResponse);
    if (q.grouped !== 'true') return NextResponse.json({ recurring_work: formatted, total: rows.length });

    // grouped view: the plumbing line counts every active plumbing row, whatever filter the list used
    const plumbingRows = await prisma.recurringWork.findMany({
      where: { is_plumbing: true, is_active: true },
      select: { last_run_ok: true, paused_on_purpose: true },
    });
    return NextResponse.json({
      recurring_work: formatted,
      total: rows.length,
      groups: groupRecurringWork(formatted),
      plumbing: { count: plumbingRows.length, stopped: plumbingRows.filter(isStopped).length },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/recurring-work - create one record of any kind
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const data = recurringWorkCreateSchema.parse(await request.json());
    assertKindFields(data);
    assertNoCopyOfCharter(data);
    await assertLinksExist(data);

    const created = await prisma.recurringWork.create({
      data: {
        kind: data.kind,
        title: data.title,
        charter_id: data.charter_id,
        charter_ware_id: data.charter_ware_id,
        sop_id: data.sop_id,
        cadence: data.cadence,
        schedule_text: data.schedule_text,
        cron_expr: data.cron_expr,
        job_key: data.job_key,
        source_kind: data.source_kind,
        source_id: data.source_id,
        owner_id: data.owner_id,
        produces: data.produces,
        client_id: data.client_id,
        site_id: data.site_id,
        initiative_id: data.initiative_id,
        is_plumbing: data.is_plumbing,
        paused_on_purpose: data.paused_on_purpose,
        group_label: data.group_label,
        sort_order: data.sort_order,
        is_active: data.is_active,
        ...convertUsageFields(data),
      } as Prisma.RecurringWorkUncheckedCreateInput,
      include: RECURRING_WORK_INCLUDE,
    });

    return NextResponse.json(formatRecurringWorkResponse(created), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
