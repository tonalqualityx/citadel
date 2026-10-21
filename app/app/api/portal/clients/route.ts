import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireClientAuth } from '@/lib/services/client-auth';
import { resolveAccessibleClients } from '@/lib/portal/access';

// GET /api/portal/clients
// The clients the signed-in PERSON can reach (matched by email across all their contact rows, plus
// agency inheritance and project-only grants), and which one is active on this session. Re-read
// on every call, so revoked access drops a client immediately. Only id, name and the person's
// role leave here; never internal fields.
export async function GET(_request: NextRequest) {
  try {
    const session = await requireClientAuth();
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
