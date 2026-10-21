import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/services/portal';
import { requestClientMagicLink } from '@/lib/services/client-auth';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

const requestSchema = z.object({
  email: z.string().email(),
});

// POST /api/portal/login/request
// A client contact requests a magic-link login. Rate-limited and intentionally non-revealing:
// always returns { requested: true } regardless of whether the email matches a contact, so the
// endpoint can't be used to enumerate which emails are clients.
export async function POST(request: NextRequest) {
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
  const rateLimitResponse = authRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { email } = requestSchema.parse(body);

    // Deliberately NOT awaited: minting and emailing take longer for a real contact than for an
    // unknown address, so awaiting would leak which emails are clients through response time.
    // The response path is identical for every email; failures are logged, never surfaced.
    void requestClientMagicLink({
      email,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    }).catch((error) => {
      console.error('Magic link request failed:', error instanceof Error ? error.message : 'unknown error');
    });

    return NextResponse.json({ requested: true });
  } catch (error) {
    return handleApiError(error);
  }
}
