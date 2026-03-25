import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatMsaVersionResponse } from '@/lib/api/formatters';

// GET /api/msa - List all MSA versions
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth();
    requireRole(user, ['pm', 'admin']);

    const msaVersions = await prisma.msaVersion.findMany({
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return NextResponse.json({
      msa_versions: msaVersions.map(formatMsaVersionResponse),
      total: msaVersions.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createMsaSchema = z.object({
  version: z.string().min(1).max(20),
  content: z.string().min(1),
  effective_date: z.string(),
  is_current: z.boolean().optional().default(false),
  change_summary: z.string().optional(),
});

// POST /api/msa - Create new MSA version
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    requireRole(user, ['admin']);
    const body = await request.json();
    const data = createMsaSchema.parse(body);

    // If setting as current, unset all others
    if (data.is_current) {
      await prisma.msaVersion.updateMany({
        where: { is_current: true },
        data: { is_current: false },
      });
    }

    const msaVersion = await prisma.msaVersion.create({
      data: {
        version: data.version,
        content: data.content,
        effective_date: new Date(data.effective_date),
        is_current: data.is_current,
        change_summary: data.change_summary,
        created_by_id: user.userId,
      },
      include: {
        created_by: { select: { id: true, name: true, email: true } },
        _count: { select: { client_msa_signatures: true } },
      },
    });

    return NextResponse.json(formatMsaVersionResponse(msaVersion), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
