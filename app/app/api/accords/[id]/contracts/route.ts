import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatContractResponse } from '@/lib/api/formatters';
import { generateContractContent } from '@/lib/services/contract-generator';

// GET /api/accords/:id/contracts - List contracts for an accord
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId } = await params;

    const contracts = await prisma.contract.findMany({
      where: {
        accord_id: accordId,
        is_deleted: false,
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        msa_version: { select: { id: true, version: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
      orderBy: { version: 'desc' },
    });

    return NextResponse.json({
      contracts: contracts.map(formatContractResponse),
      total: contracts.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createContractSchema = z.object({
  msa_version_id: z.string().uuid().optional(),
  content: z.string().optional(),
});

// POST /api/accords/:id/contracts - Generate new contract
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);
    const { id: accordId } = await params;
    const body = await request.json();
    const data = createContractSchema.parse(body);

    // Verify accord exists
    const accord = await prisma.accord.findFirst({
      where: { id: accordId, is_deleted: false },
    });

    if (!accord) {
      return NextResponse.json({ error: 'Accord not found' }, { status: 404 });
    }

    // Generate contract content
    const generated = await generateContractContent(accordId);

    // Get next version number
    const latestContract = await prisma.contract.findFirst({
      where: { accord_id: accordId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latestContract?.version ?? 0) + 1;

    // Use provided MSA version or the one from generator
    const msaVersionId = data.msa_version_id || generated.msaVersionId;

    const contract = await prisma.contract.create({
      data: {
        accord_id: accordId,
        version: nextVersion,
        content: data.content || generated.content,
        msa_version_id: msaVersionId,
        pricing_snapshot: generated.pricingSnapshot,
        created_by_id: user.userId,
      },
      include: {
        accord: { select: { id: true, name: true, status: true } },
        msa_version: { select: { id: true, version: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });

    return NextResponse.json(formatContractResponse(contract), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
