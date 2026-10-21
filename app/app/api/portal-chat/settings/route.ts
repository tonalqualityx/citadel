import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { getChatSettings, updateChatSettings } from '@/lib/portal/chat/switches';
import { refuseIfViewAs } from '@/lib/portal/view-as-guard';

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
  const viewAsRefusal = await refuseIfViewAs();
  if (viewAsRefusal) return viewAsRefusal;
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

// GET /api/portal-chat/settings (portal phase C; admin)
// What the settings page shows: the mode and daily cap, the pilot contacts by name, every site with its
// chat switch, and the contacts that can be added to the pilot.
export async function GET() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const settings = await getChatSettings();
    const [sites, contacts] = await Promise.all([
      prisma.site.findMany({
        where: { is_deleted: false },
        select: { id: true, name: true, url: true, portal_chat_enabled: true, client: { select: { id: true, name: true } } },
        orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
        take: 500,
      }),
      prisma.clientContact.findMany({
        where: { is_deleted: false, portal_role: { not: 'none' }, client: { is_deleted: false } },
        select: { id: true, name: true, email: true, portal_role: true, client: { select: { id: true, name: true } } },
        orderBy: [{ client: { name: 'asc' } }, { name: 'asc' }],
        take: 1000,
      }),
    ]);
    return NextResponse.json({
      mode: settings.mode,
      daily_cap_usd: settings.daily_cap_usd,
      pilot_contact_ids: settings.pilot_contact_ids,
      sites: sites.map((s) => ({ id: s.id, name: s.name, url: s.url, client: s.client?.name ?? null, portal_chat_enabled: s.portal_chat_enabled })),
      contacts: contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, role: c.portal_role, client: c.client.name })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
