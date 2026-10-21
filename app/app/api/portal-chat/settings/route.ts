import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { updateChatSettings } from '@/lib/portal/chat/switches';

const bodySchema = z
  .object({
    mode: z.enum(['off', 'pilot', 'on']).optional(),
    pilot_contact_ids: z.array(z.string().uuid()).max(50).optional(),
    daily_cap_usd: z.number().min(0).max(1000).optional(),
  })
  .strict();

// PUT /api/portal-chat/settings (portal phase C)
// Admin sets the mode, the pilot contacts and the daily spend cap. The Bast token may set the mode
// to `off` and nothing else: it can stop the chat, never start it.
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const body = bodySchema.parse(await request.json());

    if (auth.userId === BAST_USER_ID) {
      const keys = Object.keys(body);
      if (keys.length !== 1 || body.mode !== 'off') throw new ApiError('The Bast token may only set the mode to off', 403);
    } else {
      requireRole(auth, ['admin']);
    }

    if (body.pilot_contact_ids?.length) {
      const found = await prisma.clientContact.count({ where: { id: { in: body.pilot_contact_ids }, is_deleted: false } });
      if (found !== new Set(body.pilot_contact_ids).size) throw new ApiError('Unknown pilot contact', 400);
    }
    const settings = await updateChatSettings({
      mode: body.mode,
      pilot_contact_ids: body.pilot_contact_ids ? [...new Set(body.pilot_contact_ids)] : undefined,
      daily_cap_usd: body.daily_cap_usd,
    });
    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}
