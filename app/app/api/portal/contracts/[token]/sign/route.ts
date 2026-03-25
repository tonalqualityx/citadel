import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { validateContractToken, logPortalSession, getClientIp } from '@/lib/services/portal';

const signSchema = z.object({
  signer_name: z.string().min(1, 'Signer name is required'),
  signer_email: z.string().email('Valid email is required'),
});

// POST /api/portal/contracts/:token/sign - Sign contract (public, no auth)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const contract = await validateContractToken(token);

    if (!contract) {
      return NextResponse.json(
        { error: 'Contract not found or link has expired' },
        { status: 404 }
      );
    }

    if (contract.status !== 'sent') {
      throw new ApiError('This contract has already been signed', 400);
    }

    const body = await request.json();
    const data = signSchema.parse(body);

    const clientIp = getClientIp(request);
    const userAgent = request.headers.get('user-agent');

    // Update contract to signed
    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: 'signed',
        signed_at: new Date(),
        signer_name: data.signer_name,
        signer_email: data.signer_email,
        signer_ip: clientIp,
        signer_user_agent: userAgent,
      },
    });

    // Advance accord to 'signed' status
    await prisma.accord.update({
      where: { id: contract.accord_id },
      data: {
        status: 'signed',
        signed_at: new Date(),
        entered_current_status_at: new Date(),
      },
    });

    // Log portal action
    await logPortalSession({
      tokenType: 'contract',
      entityId: contract.id,
      ipAddress: clientIp,
      userAgent,
      action: 'sign',
      metadata: {
        signer_name: data.signer_name,
        signer_email: data.signer_email,
      },
    });

    return NextResponse.json({
      message: 'Contract signed successfully',
      signed_at: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
