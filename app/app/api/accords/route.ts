import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAccordResponse } from '@/lib/api/formatters';
import { pipelineGroupForStatus, PIPELINE_GROUP_CAP, type PipelineGroupKey } from '@/lib/pipeline';

const createAccordSchema = z.object({
  name: z.string().min(1).max(255),
  client_id: z.string().uuid().optional(),
  owner_id: z.string().uuid().optional(),
  lead_name: z.string().max(255).optional(),
  lead_business_name: z.string().max(255).optional(),
  lead_email: z.string().email().optional().or(z.literal('')),
  lead_phone: z.string().max(50).optional(),
  lead_notes: z.string().optional(),
  status: z.enum(['lead', 'meeting']).optional(),
});

// Clarity Phase 3 (Seeing Stone Reckoning, spec Q1) — the pipeline lane's read shape: 3
// forward-motion-framed groupings, each accord annotated with its OPEN arc (the work
// actually moving it forward) or null (the "no active arc" signal Mike needs — something
// in the pipeline with nothing moving it). Read-only: no stage-editing, no drag, this
// round.
interface PipelineAccordRow {
  id: string;
  name: string;
  status: string;
  lead_name: string | null;
  lead_business_name: string | null;
  client: { id: string; name: string } | null;
  open_arc: { id: string; name: string } | null;
}

async function fetchPipelineGrouped(): Promise<Record<PipelineGroupKey, PipelineAccordRow[]>> {
  const accords = await prisma.accord.findMany({
    where: { is_deleted: false },
    select: {
      id: true,
      name: true,
      status: true,
      lead_name: true,
      lead_business_name: true,
      client: { select: { id: true, name: true } },
    },
    orderBy: { entered_current_status_at: 'desc' },
  });

  const accordIds = accords.map((a) => a.id);
  const openArcs = accordIds.length
    ? await prisma.arc.findMany({
        where: { accord_id: { in: accordIds }, closed_at: null },
        select: { id: true, name: true, accord_id: true },
        orderBy: { updated_at: 'desc' },
      })
    : [];
  // First occurrence per accord_id wins — openArcs is already ordered most-recently-
  // updated first, so this is "the open arc most recently worked" per accord.
  const openArcByAccordId = new Map<string, { id: string; name: string }>();
  for (const arc of openArcs) {
    if (arc.accord_id && !openArcByAccordId.has(arc.accord_id)) {
      openArcByAccordId.set(arc.accord_id, { id: arc.id, name: arc.name });
    }
  }

  const groups: Record<PipelineGroupKey, PipelineAccordRow[]> = { prospect: [], in_motion: [], closed: [] };
  for (const accord of accords) {
    const key = pipelineGroupForStatus(accord.status);
    if (groups[key].length >= PIPELINE_GROUP_CAP) continue;
    groups[key].push({
      id: accord.id,
      name: accord.name,
      status: accord.status,
      lead_name: accord.lead_name,
      lead_business_name: accord.lead_business_name,
      client: accord.client,
      open_arc: openArcByAccordId.get(accord.id) ?? null,
    });
  }
  return groups;
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);

    if (searchParams.get('grouped') === 'pipeline') {
      const groups = await fetchPipelineGrouped();
      return NextResponse.json({ groups });
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') as 'lead' | 'meeting' | 'proposal' | 'contract' | 'signed' | 'active' | 'lost' | null;
    const owner_id = searchParams.get('owner_id') || undefined;
    const client_id = searchParams.get('client_id') || undefined;

    const where = {
      is_deleted: false,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { lead_name: { contains: search, mode: 'insensitive' as const } },
          { lead_business_name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status }),
      ...(owner_id && { owner_id }),
      ...(client_id && { client_id }),
    };

    const [accords, total] = await Promise.all([
      prisma.accord.findMany({
        where,
        include: {
          client: {
            select: { id: true, name: true, status: true },
          },
          owner: {
            select: { id: true, name: true, email: true, avatar_url: true },
          },
          _count: {
            select: {
              charter_items: { where: { is_deleted: false } },
              commission_items: { where: { is_deleted: false } },
              keep_items: { where: { is_deleted: false } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.accord.count({ where }),
    ]);

    return NextResponse.json({
      accords: accords.map(formatAccordResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createAccordSchema.parse(body);

    // Validate client exists if provided
    if (data.client_id) {
      const client = await prisma.client.findUnique({
        where: { id: data.client_id },
      });
      if (!client) {
        throw new ApiError('Client not found', 404);
      }
    }

    const accord = await prisma.accord.create({
      data: {
        name: data.name,
        status: data.status || 'lead',
        client_id: data.client_id || null,
        owner_id: data.owner_id || auth.userId,
        lead_name: data.lead_name || null,
        lead_business_name: data.lead_business_name || null,
        lead_email: data.lead_email || null,
        lead_phone: data.lead_phone || null,
        lead_notes: data.lead_notes || null,
      },
      include: {
        client: {
          select: { id: true, name: true, status: true },
        },
        owner: {
          select: { id: true, name: true, email: true, avatar_url: true },
        },
        _count: {
          select: {
            charter_items: { where: { is_deleted: false } },
            commission_items: { where: { is_deleted: false } },
            keep_items: { where: { is_deleted: false } },
          },
        },
      },
    });

    return NextResponse.json(formatAccordResponse(accord), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
