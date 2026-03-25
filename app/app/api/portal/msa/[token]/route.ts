import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { validateMsaToken, logPortalSession, getClientIp } from '@/lib/services/portal';

// GET /api/portal/msa/:token - View MSA for signing (public, no auth)
export async function GET(
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

    // Log portal access
    await logPortalSession({
      tokenType: 'msa',
      entityId: signature.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'view',
    });

    return NextResponse.json({
      id: signature.id,
      client: { name: signature.client.name },
      msa_version: {
        version: signature.msa_version.version,
        content: signature.msa_version.content,
        effective_date: signature.msa_version.effective_date,
      },
      already_signed: !!signature.signer_name,
      signed_at: signature.signed_at,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
