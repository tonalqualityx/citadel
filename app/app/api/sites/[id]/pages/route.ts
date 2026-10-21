import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { cleanText, MAX_PAGES, MAX_SECTIONS } from '@/lib/portal/chat/site-pages';

const pageSchema = z.object({
  url: z.string().url().max(1000),
  path: z.string().min(1).max(1000).startsWith('/'),
  title: z.string().max(2000),
  sections: z.array(z.object({ key: z.string().max(120), heading: z.string().max(2000) })).max(50).default([]),
  depth: z.number().int().min(0).max(20).default(0),
  source: z.enum(['sitemap', 'wright']).default('sitemap'),
});

const bodySchema = z.object({ pages: z.array(pageSchema).max(MAX_PAGES) });

// PUT /api/sites/:id/pages (portal phase C; bot)
// Replaces the site's page set from a sitemap sync. Pages in the body are upserted by path (seen
// now, no longer missing); rows not in the body are marked missing_since, never deleted.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Site not found', 404);
    const body = bodySchema.parse(await request.json());

    const site = await prisma.site.findUnique({ where: { id: id.data, is_deleted: false }, select: { id: true } });
    if (!site) throw new ApiError('Site not found', 404);

    const now = new Date();
    const seen = new Map<string, z.infer<typeof pageSchema>>();
    for (const p of body.pages) seen.set(p.path, p);

    await prisma.$transaction(
      async (tx) => {
        for (const p of seen.values()) {
          const data = {
            url: p.url,
            title: cleanText(p.title, 255) || p.path,
            sections: p.sections
              .slice(0, MAX_SECTIONS)
              .map((s) => ({ key: cleanText(s.key, 120), heading: cleanText(s.heading, 120) }))
              .filter((s) => s.heading),
            depth: p.depth,
            source: p.source,
            last_seen_at: now,
            missing_since: null,
          };
          await tx.sitePage.upsert({
            where: { site_id_path: { site_id: site.id, path: p.path } },
            create: { site_id: site.id, path: p.path, ...data },
            update: data,
          });
        }
        await tx.sitePage.updateMany({
          where: { site_id: site.id, path: { notIn: [...seen.keys()] }, missing_since: null },
          data: { missing_since: now },
        });
      },
      { timeout: 30_000 }
    );

    const [live, missing] = await Promise.all([
      prisma.sitePage.count({ where: { site_id: site.id, missing_since: null } }),
      prisma.sitePage.count({ where: { site_id: site.id, missing_since: { not: null } } }),
    ]);
    return NextResponse.json({ site_id: site.id, pages: live, missing });
  } catch (error) {
    return handleApiError(error);
  }
}

// GET /api/sites/:id/pages (portal phase C; bot and staff)
// The site's current page set, so the sync can see how many pages it is about to replace.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError('Site not found', 404);
    const site = await prisma.site.findUnique({ where: { id: id.data, is_deleted: false }, select: { id: true } });
    if (!site) throw new ApiError('Site not found', 404);
    const rows = await prisma.sitePage.findMany({
      where: { site_id: site.id },
      orderBy: [{ depth: 'asc' }, { path: 'asc' }],
      select: { id: true, path: true, title: true, source: true, missing_since: true, last_seen_at: true },
    });
    return NextResponse.json({
      site_id: site.id,
      live: rows.filter((r) => !r.missing_since).length,
      missing: rows.filter((r) => r.missing_since).length,
      pages: rows,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
