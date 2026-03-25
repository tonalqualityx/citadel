import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatProposalResponse } from '@/lib/api/formatters';

// GET /api/accords/:id/proposals - List proposals for an accord
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId } = await params;

    const proposals = await prisma.proposal.findMany({
      where: {
        accord_id: accordId,
        is_deleted: false,
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
      orderBy: { version: 'desc' },
    });

    return NextResponse.json({
      proposals: proposals.map(formatProposalResponse),
      total: proposals.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createProposalSchema = z.object({
  content: z.string().optional().default(''),
});

// POST /api/accords/:id/proposals - Create new proposal version
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId } = await params;
    const body = await request.json();
    const data = createProposalSchema.parse(body);

    // Verify accord exists
    const accord = await prisma.accord.findFirst({
      where: { id: accordId, is_deleted: false },
      include: {
        charter_items: {
          where: { is_deleted: false },
          include: { ware: { select: { id: true, name: true, type: true } } },
          orderBy: { sort_order: 'asc' },
        },
        commission_items: {
          where: { is_deleted: false },
          include: { ware: { select: { id: true, name: true, type: true } } },
          orderBy: { sort_order: 'asc' },
        },
        keep_items: {
          where: { is_deleted: false },
          include: {
            site: { select: { id: true, name: true, url: true } },
            hosting_plan: { select: { id: true, name: true, rate: true } },
            maintenance_plan: { select: { id: true, name: true, rate: true } },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    if (!accord) {
      return NextResponse.json({ error: 'Accord not found' }, { status: 404 });
    }

    // Get next version number
    const latestProposal = await prisma.proposal.findFirst({
      where: { accord_id: accordId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latestProposal?.version ?? 0) + 1;

    // Snapshot pricing from all item types
    const pricingSnapshot: any[] = [];
    for (const item of accord.charter_items) {
      pricingSnapshot.push({
        id: item.id,
        type: 'charter',
        ware_name: item.ware?.name ?? item.name_override ?? 'Unknown',
        name_override: item.name_override,
        base_price: Number(item.base_price),
        final_price: Number(item.final_price),
        billing_period: item.billing_period,
        duration_months: item.duration_months,
        total_contract_value: Number(item.total_contract_value),
      });
    }
    for (const item of accord.commission_items) {
      pricingSnapshot.push({
        id: item.id,
        type: 'commission',
        ware_name: item.ware?.name ?? item.name_override ?? 'Unknown',
        name_override: item.name_override,
        estimated_price: item.estimated_price ? Number(item.estimated_price) : null,
        final_price: item.final_price ? Number(item.final_price) : null,
      });
    }
    for (const item of accord.keep_items) {
      pricingSnapshot.push({
        id: item.id,
        type: 'keep',
        site_name: item.site?.name || item.site_name_placeholder || 'Site',
        hosting_final_price: item.hosting_final_price ? Number(item.hosting_final_price) : null,
        maintenance_final_price: item.maintenance_final_price ? Number(item.maintenance_final_price) : null,
        monthly_total: item.monthly_total ? Number(item.monthly_total) : null,
      });
    }

    const proposal = await prisma.proposal.create({
      data: {
        accord_id: accordId,
        version: nextVersion,
        content: data.content,
        pricing_snapshot: pricingSnapshot,
        created_by_id: user.userId,
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json(formatProposalResponse(proposal), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
