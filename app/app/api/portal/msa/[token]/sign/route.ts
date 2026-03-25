import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { validateMsaToken, logPortalSession, getClientIp } from '@/lib/services/portal';

const signSchema = z.object({
  signer_name: z.string().min(1),
  signer_email: z.string().email(),
});

// POST /api/portal/msa/:token/sign - Sign MSA (public, no auth)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const signature = await validateMsaToken(token);

    if (!signature) {
      return NextResponse.json(
        { error: 'MSA signing link not found or has expired' },
        { status: 404 }
      );
    }

    if (signature.signer_name) {
      throw new ApiError('This MSA has already been signed', 400);
    }

    const body = await request.json();
    const data = signSchema.parse(body);
    const clientIp = getClientIp(request);
    const userAgent = request.headers.get('user-agent');

    // Update the signature record
    await prisma.clientMsaSignature.update({
      where: { id: signature.id },
      data: {
        signed_at: new Date(),
        signer_name: data.signer_name,
        signer_email: data.signer_email,
        signer_ip: clientIp,
        signer_user_agent: userAgent,
      },
    });

    // Log portal action
    await logPortalSession({
      tokenType: 'msa',
      entityId: signature.id,
      ipAddress: clientIp,
      userAgent,
      action: 'sign',
      metadata: { signer_name: data.signer_name, signer_email: data.signer_email },
    });

    return NextResponse.json({
      message: 'MSA signed successfully',
      signed_at: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
