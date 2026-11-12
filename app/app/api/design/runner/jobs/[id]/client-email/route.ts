import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam, workerBody } from '@/lib/design/worker-kit';
import { CLIENT_EMAIL_ACTIONS, moveClientEmail } from '@/lib/design/track-client-email';

const schema = z.object({ action: z.enum(CLIENT_EMAIL_ACTIONS), reason: z.string().optional() }).strict();

const MESSAGES = {
  email_already_claimed: 'This email is already claimed or finished',
  email_not_claimed: 'This email was not claimed for sending',
  email_not_holdable: 'This email can no longer be held',
} as const;

// POST /api/design/runner/jobs/:id/client-email {action: claim | sent | held, reason?} (W6.1 F7): one send per signed
// art direction version, recorded on the DesignArtDirection row whose client_email_job_id is :id. Design-track lane only.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireTrackRunner();
    const id = idParam((await params).id, 'Job not found');
    const b = await workerBody(request, schema, 32 * 1024);
    const out = await moveClientEmail(id, b.action, b.reason);
    if (out.ok) return NextResponse.json(out.body);
    return NextResponse.json({ error: MESSAGES[out.code], code: out.code, client_email_status: out.status }, { status: 409 });
  } catch (error) {
    return handleApiError(error);
  }
}
