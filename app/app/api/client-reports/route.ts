import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { safeHttpUrl } from '@/lib/portal/retainer';

// POST /api/client-reports (portal phase B slice 2)
// Upsert a published monthly report by url. The Steward lane calls it when it publishes
// clients/<slug>/steward/<period>/publish.json: title and headline from the report, period as
// YYYY-MM, url the tracked report page. pm and admin only (the machine identity). The Retainer page
// shows the newest published report for a charter or a site it covers. Steward does not call this
// yet (no send path); until then rows are added by hand or by that lane.
const bodySchema = z.object({
  client_id: z.string().uuid(),
  charter_id: z.string().uuid().nullish(),
  site_id: z.string().uuid().nullish(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM'),
  title: z.string().trim().min(1).max(255),
  headline: z.string().trim().max(2000).nullish(),
  url: z.string().max(500),
  published_at: z.string().datetime({ offset: true }).nullish(),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const data = bodySchema.parse(await request.json());
    const url = safeHttpUrl(data.url);
    if (!url) throw new ApiError('url must be an http or https link', 400, 'bad_url');

    const client = await prisma.client.findFirst({ where: { id: data.client_id, is_deleted: false }, select: { id: true } });
    if (!client) throw new ApiError('Client not found', 404);
    if (data.charter_id) {
      const charter = await prisma.charter.findFirst({ where: { id: data.charter_id, client_id: client.id, is_deleted: false }, select: { id: true } });
      if (!charter) throw new ApiError('Charter not found on that client', 404);
    }
    if (data.site_id) {
      const site = await prisma.site.findFirst({ where: { id: data.site_id, client_id: client.id, is_deleted: false }, select: { id: true } });
      if (!site) throw new ApiError('Site not found on that client', 404);
    }

    const fields = {
      client_id: client.id,
      charter_id: data.charter_id ?? null,
      site_id: data.site_id ?? null,
      period: data.period,
      title: data.title,
      headline: data.headline ?? null,
      published_at: data.published_at ? new Date(data.published_at) : null,
    };
    const existing = await prisma.clientReport.findUnique({ where: { url }, select: { id: true, client_id: true } });
    if (existing && existing.client_id !== client.id) throw new ApiError('That report url belongs to another client.', 409, 'url_taken');
    const report = existing
      ? await prisma.clientReport.update({ where: { url }, data: fields })
      : await prisma.clientReport.create({ data: { ...fields, url } });
    return NextResponse.json({ report }, { status: existing ? 200 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
