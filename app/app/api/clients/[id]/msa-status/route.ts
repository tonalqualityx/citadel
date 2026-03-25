import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatClientMsaSignatureResponse } from '@/lib/api/formatters';

// GET /api/clients/:id/msa-status - Check if client has signed current MSA
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: clientId } = await params;

    // Get current MSA version
    const currentMsa = await prisma.msaVersion.findFirst({
      where: { is_current: true },
    });

    if (!currentMsa) {
      return NextResponse.json({
        has_current_msa: false,
        signed_current: false,
        current_msa_version: null,
        signature: null,
      });
    }

    // Check if client signed the current version
    const signature = await prisma.clientMsaSignature.findUnique({
      where: {
        client_id_msa_version_id: {
          client_id: clientId,
          msa_version_id: currentMsa.id,
        },
      },
      include: {
        client: { select: { id: true, name: true } },
        msa_version: { select: { id: true, version: true } },
      },
    });

    return NextResponse.json({
      has_current_msa: true,
      signed_current: !!signature,
      current_msa_version: currentMsa.version,
      signature: signature ? formatClientMsaSignatureResponse(signature) : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
