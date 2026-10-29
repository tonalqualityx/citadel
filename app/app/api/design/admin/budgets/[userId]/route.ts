import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { isUuid, toUsd } from '@/lib/design/helpers';
import { authActor, body, guardMutation, requireAdmin, requireSessionVia } from '@/lib/design/route-kit';

const budgetSchema = z
  .object({
    monthly_cap_usd: z.number().finite().min(0).max(100000).nullable(),
    session_raise_cap_usd: z.number().finite().min(0).max(5000).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

async function write(request: NextRequest, params: Promise<{ userId: string }>) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor({ operator: 'setup' });
    requireSessionVia(actor, 'setup');
    requireAdmin(actor);
    const { userId } = await params;
    if (!isUuid(userId)) throw new ApiError('User not found', 404, 'not_found');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } });
    if (!user) throw new ApiError('User not found', 404, 'not_found');
    const input = await body(request, budgetSchema, 4096);
    const row = await prisma.designBudget.upsert({
      where: { user_id: userId },
      create: { user_id: userId, ...input, updated_by_id: actor.userId },
      update: { ...input, updated_by_id: actor.userId },
    });
    return NextResponse.json({
      budget: {
        user: { id: user.id, name: user.name },
        monthly_cap_usd: row.monthly_cap_usd != null ? toUsd(row.monthly_cap_usd) : null,
        session_raise_cap_usd: row.session_raise_cap_usd != null ? toUsd(row.session_raise_cap_usd) : null,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// PUT /api/design/admin/budgets/:userId (design 7.2); PATCH is accepted as the same merge (fields left out stay).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  return write(request, params);
}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  return write(request, params);
}
