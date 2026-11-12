import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { buildWorkIndex } from '@/lib/work/sessions-store';
import { SESSION_LANES, requireWorkCaller } from '@/lib/work/route-auth';

/**
 * Work stage E: GET /api/oracle/work-index, what the session hooks cache on the machine (the heartbeat refreshes it each minute).
 * 200 {generated_at, projects: [live projects with client, plan_folder, site_repo_url, open_tasks], sites, clients (with slugs),
 * tasks: [open tasks with short_id, href, security], session_links: [{session_ref, target_key, label, basis, cwds, machine}]}.
 * Optional ?machine=<name> keeps the session links of that machine (and links whose session is not known yet). No mail, no addresses,
 * no bodies. Read only. The oracle lane, and the owner's session.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireWorkCaller(auth, SESSION_LANES);
    const machine = request.nextUrl.searchParams.get('machine');
    const out = await buildWorkIndex(prisma, { machine: machine && machine.length <= 100 ? machine : null });
    return NextResponse.json(out);
  } catch (error) {
    return handleApiError(error);
  }
}
