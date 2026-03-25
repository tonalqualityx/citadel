import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { formatAutomationRuleResponse } from '@/lib/api/formatters';

const accordStatusValues = [
  'lead', 'meeting', 'proposal', 'contract', 'signed', 'active', 'lost',
] as const;

const createRuleSchema = z.object({
  name: z.string().min(1).max(255),
  trigger_type: z.enum(['status_change', 'time_based']),
  trigger_status: z.enum(accordStatusValues),
  trigger_from_status: z.enum(accordStatusValues).optional().nullable(),
  time_threshold_hours: z.number().int().positive().optional().nullable(),
  action_type: z.string().max(20).default('create_task'),
  task_template: z.object({
    title: z.string(),
    description: z.string().optional(),
    priority: z.string().optional(),
    function_id: z.string().uuid().optional(),
    due_offset_hours: z.number().optional(),
  }),
  assignee_rule: z.enum(['accord_owner', 'meeting_attendees', 'specific_user']),
  assignee_user_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
}).refine(
  (data) => {
    if (data.trigger_type === 'time_based' && !data.time_threshold_hours) {
      return false;
    }
    return true;
  },
  { message: 'time_threshold_hours is required when trigger_type is time_based', path: ['time_threshold_hours'] }
).refine(
  (data) => {
    if (data.assignee_rule === 'specific_user' && !data.assignee_user_id) {
      return false;
    }
    return true;
  },
  { message: 'assignee_user_id is required when assignee_rule is specific_user', path: ['assignee_user_id'] }
);

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const rules = await prisma.salesAutomationRule.findMany({
      include: {
        assignee_user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { sort_order: 'asc' },
    });

    return NextResponse.json({
      rules: rules.map(formatAutomationRuleResponse),
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
    const data = createRuleSchema.parse(body);

    const rule = await prisma.salesAutomationRule.create({
      data: {
        name: data.name,
        trigger_type: data.trigger_type,
        trigger_status: data.trigger_status,
        trigger_from_status: data.trigger_from_status || null,
        time_threshold_hours: data.time_threshold_hours || null,
        action_type: data.action_type,
        task_template: data.task_template,
        assignee_rule: data.assignee_rule,
        assignee_user_id: data.assignee_user_id || null,
        is_active: data.is_active ?? true,
        sort_order: data.sort_order ?? 0,
      },
      include: {
        assignee_user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(formatAutomationRuleResponse(rule), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
