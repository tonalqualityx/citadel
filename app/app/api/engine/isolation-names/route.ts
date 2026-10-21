import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { requireEngine } from '@/lib/engine/auth';

// GET /api/engine/isolation-names (portal phase C, engine scope)
// Every client display name and site domain: the list the runner's isolation check probes a client
// run against, to prove no other client's name reaches a reply. Names only; nothing else.
export async function GET() {
  try {
    await requireEngine();
    const [clients, sites] = await Promise.all([
      prisma.client.findMany({ where: { is_deleted: false }, select: { name: true } }),
      prisma.site.findMany({ where: { is_deleted: false, url: { not: null } }, select: { url: true } }),
    ]);
    const domains = new Set<string>();
    for (const s of sites) {
      try {
        domains.add(new URL(s.url as string).hostname.replace(/^www\./, ''));
      } catch {
        /* not a URL */
      }
    }
    return NextResponse.json({
      names: [...new Set(clients.map((c) => c.name.trim()).filter(Boolean))].sort(),
      domains: [...domains].sort(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
