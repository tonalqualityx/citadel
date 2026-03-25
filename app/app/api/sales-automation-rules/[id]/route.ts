import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatAutomationRuleResponse } from '@/lib/api/formatters';

const accordStatusValues = [
  'lead', 'meeting', 'proposal', 'contract', 'signed', 'active', 'lost',
] as const;

const updateRuleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  trigger_type: z.enum(['status_change', 'time_based']).optional(),
  trigger_status: z.enum(accordStatusValues).optional(),
  trigger_from_status: z.enum(accordStatusValues).optional().nullable(),
  time_threshold_hours: z.number().int().positive().optional().nullable(),
  action_type: z.string().max(20).optional(),
  task_template: z.object({
    title: z.string(),
    description: z.string().optional(),
    priority: z.string().optional(),
    function_id: z.string().uuid().optional(),
    due_offset_hours: z.number().optional(),
  }).optional(),
  assignee_rule: z.enum(['accord_owner', 'meeting_attendees', 'specific_user']).optional(),
  assignee_user_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    const rule = await prisma.salesAutomationRule.findUnique({
      where: { id },
      include: {
        assignee_user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!rule) {
      throw new ApiError('Automation rule not found', 404);
    }

    return NextResponse.json(formatAutomationRuleResponse(rule));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = updateRuleSchema.parse(body);

    const rule = await prisma.salesAutomationRule.update({
      where: { id },
      data,
      include: {
        assignee_user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(formatAutomationRuleResponse(rule));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);
    const { id } = await params;

    // Hard delete rule and its automation logs
    await prisma.$transaction([
      prisma.salesAutomationLog.deleteMany({
        where: { rule_id: id },
      }),
      prisma.salesAutomationRule.delete({
        where: { id },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
