import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { formatInitiativeNumberResponse, formatInitiativeResponse } from '@/lib/api/formatters';
import { readingSchema, recomputeHealth } from '@/lib/initiatives/service';

// POST /api/initiatives/[id]/readings - record a value for one of the initiative's numbers
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const data = readingSchema.parse(await request.json());

    const number = await prisma.initiativeNumber.findFirst({
      where: { id: data.number_id, initiative_id: id, initiative: { is_deleted: false } },
    });
    if (!number) throw new ApiError('Number not found', 404);

    const readAt = data.read_at ? new Date(data.read_at) : new Date();
    const reading = await prisma.initiativeReading.create({
      data: { number_id: number.id, value: data.value, read_at: readAt, source: data.source },
    });

    // The newest reading is the number's last value; an older, back-dated one is kept but does not replace it.
    const numberUpdate: Record<string, unknown> = {};
    if (!number.last_read_at || readAt.getTime() >= number.last_read_at.getTime()) {
      numberUpdate.last_value = data.value;
      numberUpdate.last_read_at = readAt;
    }
    // A number with no baseline takes its first reading as the baseline.
    if (number.baseline_value === null || number.baseline_value === undefined) {
      numberUpdate.baseline_value = data.value;
      numberUpdate.baseline_at = readAt;
    }
    const updatedNumber = Object.keys(numberUpdate).length
      ? await prisma.initiativeNumber.update({ where: { id: number.id }, data: numberUpdate })
      : number;

    const initiative = await recomputeHealth(id);
    return NextResponse.json(
      {
        reading: {
          id: reading.id,
          number_id: reading.number_id,
          value: Number(reading.value),
          read_at: reading.read_at,
          source: reading.source,
        },
        number: formatInitiativeNumberResponse(updatedNumber),
        initiative: formatInitiativeResponse(initiative),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
