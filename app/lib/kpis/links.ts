import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';

/** Throws 400 when a linked id does not exist or belongs to another client. */
export async function assertLinksBelongToClient(
  clientId: string,
  links: { site_id?: string | null; accord_id?: string | null; charter_id?: string | null }
) {
  const client = await prisma.client.findFirst({ where: { id: clientId, is_deleted: false }, select: { id: true } });
  if (!client) throw new ApiError('Client not found', 400);
  if (links.site_id) {
    const s = await prisma.site.findFirst({ where: { id: links.site_id, client_id: clientId, is_deleted: false }, select: { id: true } });
    if (!s) throw new ApiError('site_id is not a site of this client', 400);
  }
  if (links.accord_id) {
    const a = await prisma.accord.findFirst({ where: { id: links.accord_id, client_id: clientId, is_deleted: false }, select: { id: true } });
    if (!a) throw new ApiError('accord_id is not an accord of this client', 400);
  }
  if (links.charter_id) {
    const c = await prisma.charter.findFirst({ where: { id: links.charter_id, client_id: clientId, is_deleted: false }, select: { id: true } });
    if (!c) throw new ApiError('charter_id is not a charter of this client', 400);
  }
}
