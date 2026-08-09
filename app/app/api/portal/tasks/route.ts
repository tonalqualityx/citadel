import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { formatTaskForClient } from '@/lib/api/client-projections';

// GET /api/portal/tasks (Portal v2 phase 1)
// The logged-in client's tasks: those awaiting THEIR approval, plus recently-approved ones —
// mirroring the GET /api/portal/articles session-scoped list pattern. Scope is implicit and
// un-spoofable (client_id comes from the session, never from input) via the same
// client_id-OR-site.client_id resolution used by the token flow (lib/services/portal.ts's
// resolveTaskContact), since not every task has client_id set directly.
//
// "Awaiting approval" = the client hasn't approved it yet (client_approved_at is null). This is
// intentionally NOT gated on a minted portal_token — a client_session can review/approve any of
// its own tasks, independent of whether a one-off email link was ever sent for it. Per-item
// approve/request-changes actions live at POST /api/portal/tasks/mine/:id/{approve,request-changes}
// (a distinct path from the token-gated /api/portal/tasks/:token/*, since Next.js route groups
// cannot mix two differently-named dynamic segments at the same level).
//   no session → 401 (requireClientAuth)
//   own client → 200 { pending: ClientTask[], recently_approved: ClientTask[] }
export async function GET(_request: NextRequest) {
  try {
    const session = await requireClientAuth();

    const scope = {
      is_deleted: false,
      OR: [{ client_id: session.clientId }, { site: { client_id: session.clientId } }],
    };

    const [pending, recentlyApproved] = await Promise.all([
      prisma.task.findMany({
        where: { ...scope, client_approved_at: null },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          estimated_minutes: true,
          staging_preview_url: true,
          staging_deployed_at: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { updated_at: 'desc' },
        take: 50,
      }),
      prisma.task.findMany({
        where: { ...scope, client_approved_at: { not: null } },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          estimated_minutes: true,
          client_approved_at: true,
          created_at: true,
          updated_at: true,
        },
        orderBy: { client_approved_at: 'desc' },
        take: 10,
      }),
    ]);

    return NextResponse.json({
      pending: pending.map((task) => ({
        ...formatTaskForClient(task),
        staging_preview_url: task.staging_preview_url,
        staging_deployed_at: task.staging_deployed_at,
      })),
      recently_approved: recentlyApproved.map((task) => ({
        ...formatTaskForClient(task),
        client_approved_at: task.client_approved_at,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
