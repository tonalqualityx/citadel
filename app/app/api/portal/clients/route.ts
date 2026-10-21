import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { resolveAccessibleClients } from '@/lib/portal/access';
import { prisma } from '@/lib/db/prisma';
import { VIEW_AS_TTL_MS } from '@/lib/portal/view-as';

// GET /api/portal/clients
// The clients the signed-in PERSON can reach (matched by email across all their contact rows, plus
// agency inheritance and project-only grants), and which one is active on this session. Re-read
// on every call, so revoked access drops a client immediately. Only id, name and the person's
// role leave here; never internal fields.
export async function GET(_request: NextRequest) {
  try {
    const session = await requireClientAuth();
    // An admin's read-only view is pinned to one client: no picker, and the banner reads this.
    if (session.viewAs) {
      const [client, row] = await Promise.all([
        prisma.client.findFirst({ where: { id: session.clientId }, select: { name: true } }),
        prisma.portalSession.findFirst({ where: { id: session.sessionId }, select: { created_at: true } }),
      ]);
      const name = client?.name ?? '';
      return NextResponse.json({
        active_client_id: session.clientId,
        moved: false,
        clients: [{ id: session.clientId, name, role: session.role, project_only: false }],
        view_as: {
          client_id: session.clientId,
          client_name: name,
          role: session.role,
          expires_at: row ? new Date(row.created_at.getTime() + VIEW_AS_TTL_MS).toISOString() : null,
        },
      });
    }
    const accessible = await resolveAccessibleClients(session.email);
    return NextResponse.json({
      active_client_id: session.clientId,
      moved: session.moved,
      clients: accessible.map((c) => ({
        id: c.clientId,
        name: c.name,
        role: c.role,
        project_only: c.role === 'none',
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
