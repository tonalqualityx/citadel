import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatMsaVersionResponse } from '@/lib/api/formatters';

// GET /api/msa/current - Get the current active MSA version
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);

    const currentMsa = await prisma.msaVersion.findFirst({
      where: { is_current: true },
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
    });

    if (!currentMsa) {
      return NextResponse.json({ error: 'No current MSA version set' }, { status: 404 });
    }

    return NextResponse.json(formatMsaVersionResponse(currentMsa));
  } catch (error) {
    return handleApiError(error);
  }
}
