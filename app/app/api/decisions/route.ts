import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import {
  ACTIVE_STATUSES,
  DECISION_INCLUDE,
  DECISION_KINDS,
  DECISION_SCOPES,
  DECISION_STATUSES,
  POSTABLE_STATUSES,
  createDecisionSchema,
  formatDecision,
  requireWriter,
  assertUuid,
} from '@/lib/decisions';

// Fleet item 2: the decision record. GET lists with filters (status=active means
// recorded_from_source + confirmed). POST is for bots and people alike but can only write
// proposed or recorded_from_source: confirmed comes from /confirm or /import, never from here.

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const sp = new URL(request.url).searchParams;
    const where: Prisma.DecisionWhereInput = {};

    const status = sp.get('status');
    if (status === 'active') where.status = { in: [...ACTIVE_STATUSES] };
    else if (status) {
      if (!(DECISION_STATUSES as readonly string[]).includes(status)) throw new ApiError('Invalid status filter', 400);
      where.status = status as (typeof DECISION_STATUSES)[number];
    }
    const scope = sp.get('scope');
    if (scope) {
      if (!(DECISION_SCOPES as readonly string[]).includes(scope)) throw new ApiError('Invalid scope filter', 400);
      where.scope = scope as (typeof DECISION_SCOPES)[number];
    }
    const kind = sp.get('kind');
    if (kind) {
      if (!(DECISION_KINDS as readonly string[]).includes(kind)) throw new ApiError('Invalid kind filter', 400);
      where.kind = kind as (typeof DECISION_KINDS)[number];
    }
    for (const f of ['lane', 'key'] as const) {
      const v = sp.get(f);
      if (v) where[f] = v;
    }
    for (const f of ['client_id', 'project_id', 'charter_id', 'site_id', 'accord_id'] as const) {
      const v = sp.get(f);
      if (v) {
        assertUuid(v, f);
        where[f] = v;
      }
    }
    const q = sp.get('q');
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { text: { contains: q, mode: 'insensitive' } },
      ];
    }
    const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '200', 10) || 200, 1), 500);

    const rows = await prisma.decision.findMany({
      where,
      include: DECISION_INCLUDE,
      orderBy: { created_at: 'desc' },
      take: limit,
    });
    return NextResponse.json({ decisions: rows.map(formatDecision), total: rows.length });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    requireWriter(user);
    const data = createDecisionSchema.parse(await request.json());

    if (!(POSTABLE_STATUSES as readonly string[]).includes(data.status)) {
      throw new ApiError('Only proposed or recorded_from_source can be written here', 403);
    }

    if (data.key) {
      const dup = await prisma.decision.findUnique({ where: { key: data.key }, include: DECISION_INCLUDE });
      if (dup) return NextResponse.json(formatDecision(dup), { status: 200 });
    }

    const created = await prisma.decision.create({
      data: {
        key: data.key ?? null,
        title: data.title,
        text: data.text,
        kind: data.kind,
        status: data.status,
        scope: data.scope,
        lane: data.lane ?? null,
        client_id: data.client_id ?? null,
        project_id: data.project_id ?? null,
        charter_id: data.charter_id ?? null,
        site_id: data.site_id ?? null,
        accord_id: data.accord_id ?? null,
        author_user_id: data.author_user_id ?? null,
        author_contact_id: data.author_contact_id ?? null,
        ruled_at: data.ruled_at ?? null,
        conflict_note: data.conflict_note ?? null,
        confidence: data.confidence ?? null,
        tags: data.tags,
        created_by_id: user.userId,
        sources: {
          create: data.sources.map((s) => ({
            kind: s.kind,
            ref: s.ref,
            thread_ref: s.thread_ref ?? null,
            quote: s.quote ?? null,
            author_label: s.author_label ?? null,
            author_user_id: s.author_user_id ?? null,
            author_contact_id: s.author_contact_id ?? null,
            at: s.at ?? null,
            extracted_by: s.extracted_by ?? null,
          })),
        },
        links: {
          create: data.links.map((l) => ({ entity_kind: l.entity_kind, entity_id: l.entity_id, relation: l.relation })),
        },
      },
      include: DECISION_INCLUDE,
    });
    return NextResponse.json(formatDecision(created), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
