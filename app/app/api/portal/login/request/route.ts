import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { authRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/services/portal';
import { requestClientMagicLink } from '@/lib/services/client-auth';

const requestSchema = z.object({
  email: z.string().email(),
});

// POST /api/portal/login/request
// A client contact requests a magic-link login. Rate-limited and intentionally non-revealing:
// always returns { requested: true } regardless of whether the email matches a contact, so the
// endpoint can't be used to enumerate which emails are clients.
export async function POST(request: NextRequest) {
  const rateLimitResponse = authRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { email } = requestSchema.parse(body);

    await requestClientMagicLink({
      email,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    });

    return NextResponse.json({ requested: true });
  } catch (error) {
    return handleApiError(error);
  }
}
