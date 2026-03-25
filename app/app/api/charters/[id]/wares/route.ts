import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatCharterWareResponse } from '@/lib/api/formatters';

const createCharterWareSchema = z.object({
  ware_id: z.string().uuid(),
  price: z.number().min(0),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const charter = await prisma.charter.findFirst({
      where: { id, is_deleted: false },
    });

    if (!charter) {
      throw new ApiError('Charter not found', 404);
    }

    const body = await request.json();
    const data = createCharterWareSchema.parse(body);

    const charterWare = await prisma.charterWare.create({
      data: {
        charter_id: id,
        ware_id: data.ware_id,
        price: data.price,
      },
      include: {
        ware: { select: { id: true, name: true, type: true } },
      },
    });

    return NextResponse.json(formatCharterWareResponse(charterWare), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
