import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { rateLimitByKey } from '@/lib/api/rate-limit';
import { prisma } from '@/lib/db/prisma';
import { sendEmail } from '@/lib/services/email';
import { loadSessionFor } from '@/lib/design/access';
import { authActor, body, guardMutation, type IdParams } from '@/lib/design/route-kit';
import { buildPreviewLink } from '@/lib/design/preview-link';

// Strict: an `email` or `to` field is a 400. The address always comes from the database, never from the request.
const schema = z.object({ path: z.string().max(4096) }).strict();

export const PREVIEW_LINKS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// POST /api/design/sessions/:id/preview-link (SPEC 4.10, 4.11 #15): emails the current-page preview link to the caller's OWN
// Citadel address. The link is built here from the session's stored preview URL plus the validated path. 10 per hour per
// user. Access is the sibling pattern for a non-signing action (home-ready): the session's designer or an admin; another
// designer 404, a pm 403. Whoever calls gets the mail at their own address.
export async function POST(request: NextRequest, { params }: IdParams) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    const { id } = await params;
    const session = await loadSessionFor(actor, id, { mode: 'write' });
    const input = await body(request, schema, 4096);
    if (!session.preview_url) throw new ApiError('The preview is not ready yet', 409, 'no_preview');
    const link = buildPreviewLink(session.preview_url, input.path);
    if (!link) throw new ApiError('That page cannot be sent as a link', 400, 'bad_path');

    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { email: true } });
    if (!user?.email) throw new ApiError('Your account has no email address', 409, 'no_email');
    const site = await prisma.site.findUnique({ where: { id: session.site_id }, select: { name: true } });
    const siteName = site?.name?.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 120) || 'your site';

    // Keyed on the signed-in user alone: a caller-set X-Forwarded-For must not reset it (W6.1 F3).
    const limited = rateLimitByKey(actor.userId, PREVIEW_LINKS_PER_HOUR, HOUR_MS, 'design-preview-link');
    if (limited) return limited;

    const subject = `Your preview link for ${siteName}`;
    const text = [
      `Here is the preview link for ${siteName} that you asked for.`,
      '',
      link,
      '',
      'This preview is not public. Please do not forward it.',
    ].join('\n');
    const html = `<p>Here is the preview link for ${esc(siteName)} that you asked for.</p><p><a href="${esc(link)}">${esc(link)}</a></p><p>This preview is not public. Please do not forward it.</p>`;
    await sendEmail({
      to: user.email,
      subject,
      text,
      html,
      kind: 'notification',
      allowExternal: true,
      govern: { intent: 'none', reason: 'a link the designer asked for, sent to her own address' },
    });
    return NextResponse.json({ sent: true });
  } catch (error) {
    return handleApiError(error);
  }
}
