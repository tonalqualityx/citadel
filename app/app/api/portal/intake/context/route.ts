import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { rateLimit } from '@/lib/api/rate-limit';
import { requireClientAuth } from '@/lib/services/client-auth';
import { loadPortalAccess, projectAccessWhere } from '@/lib/portal/access';
import { OPEN_BUILD_STATUSES } from '@/lib/portal/intake/placement';
import { planLabel } from '@/lib/portal/engagement';
import { chatAvailability } from '@/lib/portal/chat/switches';

// GET /api/portal/intake/context (portal phase B slice 1)
// What the request chat needs to ask "Which site is this about?" and to preview where a request
// will land: the client's sites, open builds the contact may see, and the live charters. The
// browser runs the same pure placement function for the summary line; the server re-checks
// every id at filing, so nothing here is trusted. Allow-list only: no internal charter names.
export async function GET(request: NextRequest) {
  try {
    const limited = rateLimit(request, 120);
    if (limited) return limited;
    const session = await requireClientAuth();
    const access = await loadPortalAccess(session);
    const canRequest = !access.revoked && access.role !== 'none';
    if (!canRequest) {
      return NextResponse.json({ can_request: false, sites: [], open_builds: [], charters: [] });
    }

    const [sites, projects, charters] = await Promise.all([
      prisma.site.findMany({
        where: { client_id: access.clientId, is_deleted: false },
        select: { id: true, name: true, maintenance_plan_id: true, hosting_plan_id: true },
        orderBy: { name: 'asc' },
      }),
      prisma.project.findMany({
        where: { ...projectAccessWhere(access), status: { in: [...OPEN_BUILD_STATUSES] } },
        select: { id: true, name: true, site_id: true, status: true, scope_locked: true },
        orderBy: { name: 'asc' },
      }),
      prisma.charter.findMany({
        where: { client_id: access.clientId, is_deleted: false, status: { in: ['active', 'paused'] } },
        select: {
          id: true,
          site_id: true,
          status: true,
          start_date: true,
          end_date: true,
          created_at: true,
          charter_wares: { where: { is_active: true }, select: { ware: { select: { name: true } } } },
        },
      }),
    ]);

    // Portal phase C: whether the request page is the chat (true) or the stepper (false).
    const avail = await chatAvailability({ contactId: access.contactId, clientId: access.clientId });
    const chatOn = avail.available || avail.reason === 'runner_down' || avail.reason.endsWith('_jobs') || avail.reason.endsWith('_spend');

    return NextResponse.json({
      can_request: true,
      chat: { available: chatOn },
      sites: sites.map((s) => ({ id: s.id, name: s.name, has_plan: Boolean(s.maintenance_plan_id || s.hosting_plan_id) })),
      open_builds: projects,
      charters: charters.map((c) => ({
        id: c.id,
        site_id: c.site_id,
        status: c.status,
        start_date: c.start_date,
        end_date: c.end_date,
        created_at: c.created_at,
        label: planLabel(c.charter_wares.map((w) => w.ware?.name ?? '')),
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
