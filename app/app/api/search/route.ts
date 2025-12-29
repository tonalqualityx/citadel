import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    // Search in parallel across all entities
    const [clients, sites, projects, tasks, sops, domains, tools] = await Promise.all([
      // Clients (Patrons)
      prisma.client.findMany({
        where: {
          is_deleted: false,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { primary_contact: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, type: true },
        take: 5,
      }),

      // Sites
      prisma.site.findMany({
        where: {
          is_deleted: false,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { url: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, url: true, client: { select: { name: true } } },
        take: 5,
      }),

      // Projects (Pacts)
      prisma.project.findMany({
        where: {
          is_deleted: false,
          name: { contains: query, mode: 'insensitive' },
        },
        select: { id: true, name: true, status: true, client: { select: { name: true } } },
        take: 5,
      }),

      // Tasks (Quests)
      prisma.task.findMany({
        where: {
          is_deleted: false,
          title: { contains: query, mode: 'insensitive' },
          // Apply visibility rules for Tech users
          ...(auth.role === 'tech' && {
            OR: [
              { project_id: null, assignee_id: auth.userId },
              {
                assignee_id: auth.userId,
                project: { status: { in: ['ready', 'in_progress', 'review', 'done'] } },
              },
            ],
          }),
        },
        select: {
          id: true,
          title: true,
          status: true,
          project: { select: { name: true } },
        },
        take: 5,
      }),

      // SOPs (Runes)
      prisma.sop.findMany({
        where: {
          is_active: true,
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, title: true, function: { select: { name: true } } },
        take: 5,
      }),

      // Domains
      prisma.domain.findMany({
        where: {
          is_deleted: false,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { registrar: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, site: { select: { name: true } } },
        take: 5,
      }),

      // Tools
      prisma.tool.findMany({
        where: {
          is_active: true,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { category: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, category: true },
        take: 5,
      }),
    ]);

    const results = [
      ...clients.map((c) => ({
        type: 'patron' as const,
        id: c.id,
        title: c.name,
        subtitle: c.type,
        url: `/clients/${c.id}`,
      })),
      ...sites.map((s) => ({
        type: 'site' as const,
        id: s.id,
        title: s.name,
        subtitle: s.client?.name || s.url || '',
        url: `/sites/${s.id}`,
      })),
      ...projects.map((p) => ({
        type: 'pact' as const,
        id: p.id,
        title: p.name,
        subtitle: p.client?.name || p.status,
        url: `/projects/${p.id}`,
      })),
      ...tasks.map((t) => ({
        type: 'quest' as const,
        id: t.id,
        title: t.title,
        subtitle: t.project?.name || t.status,
        url: `/tasks/${t.id}`,
      })),
      ...sops.map((s) => ({
        type: 'rune' as const,
        id: s.id,
        title: s.title,
        subtitle: s.function?.name || 'General',
        url: `/sops/${s.id}`,
      })),
      ...domains.map((d) => ({
        type: 'domain' as const,
        id: d.id,
        title: d.name,
        subtitle: d.site?.name,
        url: `/domains/${d.id}`,
      })),
      ...tools.map((t) => ({
        type: 'tool' as const,
        id: t.id,
        title: t.name,
        subtitle: t.category,
        url: `/tools/${t.id}`,
      })),
    ];

    return NextResponse.json({ results });
  } catch (error) {
    return handleApiError(error);
  }
}
