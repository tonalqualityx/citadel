import { prisma } from '@/lib/db/prisma';
import type { AccordStatus, SalesAutomationRule, Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskTemplate {
  title: string;
  description?: string;
  priority?: number;
  function_id?: string;
  due_offset_hours?: number;
}

export interface FiredRuleResult {
  ruleId: string;
  ruleName: string;
  taskIds: string[];
  skipped: boolean;
  skipReason?: string;
}

export interface AutomationCronSummary {
  rulesEvaluated: number;
  accordsChecked: number;
  tasksFired: number;
  errors: string[];
}

type SalesAutomationRuleWithUser = SalesAutomationRule & {
  assignee_user: { id: string; name: string } | null;
};

type AccordForAutomation = {
  id: string;
  name: string;
  owner_id: string;
  status: AccordStatus;
  entered_current_status_at: Date;
  meeting_accords: { meeting: { attendees: { user_id: string }[] } }[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fire status-change rules when an accord transitions to a new status.
 * Called from the accord status update API route.
 */
export async function fireStatusChangeRules(
  accordId: string,
  newStatus: AccordStatus,
  fromStatus?: AccordStatus,
): Promise<FiredRuleResult[]> {
  const rules = await prisma.salesAutomationRule.findMany({
    where: {
      trigger_type: 'status_change',
      trigger_status: newStatus,
      is_active: true,
    },
    include: { assignee_user: true },
    orderBy: { sort_order: 'asc' },
  });

  if (rules.length === 0) return [];

  const accord = await prisma.accord.findUniqueOrThrow({
    where: { id: accordId },
    include: {
      meeting_accords: {
        include: { meeting: { include: { attendees: { select: { user_id: true } } } } },
      },
    },
  });

  const results: FiredRuleResult[] = [];

  for (const rule of rules) {
    try {
      // If the rule requires a specific "from" status, check it
      if (rule.trigger_from_status && rule.trigger_from_status !== fromStatus) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          taskIds: [],
          skipped: true,
          skipReason: `from_status mismatch: expected ${rule.trigger_from_status}, got ${fromStatus ?? 'undefined'}`,
        });
        continue;
      }

      // Idempotency check — skip if this rule already fired for this accord
      const existingLog = await prisma.salesAutomationLog.findUnique({
        where: { rule_id_accord_id: { rule_id: rule.id, accord_id: accordId } },
      });

      if (existingLog) {
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          taskIds: [],
          skipped: true,
          skipReason: 'already fired (log exists)',
        });
        continue;
      }

      const result = await executeRule(rule, accord);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[sales-automation] Error firing rule "${rule.name}" for accord ${accordId}: ${message}`);
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        taskIds: [],
        skipped: true,
        skipReason: `error: ${message}`,
      });
    }
  }

  return results;
}

/**
 * Evaluate all time-based rules across all accords.
 * Called from the cron job. Idempotent via SalesAutomationLog.
 */
export async function evaluateTimeBasedRules(): Promise<AutomationCronSummary> {
  const summary: AutomationCronSummary = {
    rulesEvaluated: 0,
    accordsChecked: 0,
    tasksFired: 0,
    errors: [],
  };

  const rules = await prisma.salesAutomationRule.findMany({
    where: {
      trigger_type: 'time_based',
      is_active: true,
      time_threshold_hours: { not: null },
    },
    include: { assignee_user: true },
    orderBy: { sort_order: 'asc' },
  });

  summary.rulesEvaluated = rules.length;

  if (rules.length === 0) {
    console.log('[sales-automation] No active time-based rules found');
    return summary;
  }

  // Gather all trigger statuses we need to look at
  const triggerStatuses = [...new Set(rules.map((r) => r.trigger_status))];

  const accords = await prisma.accord.findMany({
    where: {
      status: { in: triggerStatuses },
      is_deleted: false,
    },
    include: {
      meeting_accords: {
        include: { meeting: { include: { attendees: { select: { user_id: true } } } } },
      },
    },
  });

  summary.accordsChecked = accords.length;
  const now = Date.now();

  for (const rule of rules) {
    const thresholdMs = (rule.time_threshold_hours ?? 0) * 60 * 60 * 1000;
    const matchingAccords = accords.filter((a) => a.status === rule.trigger_status);

    for (const accord of matchingAccords) {
      try {
        const elapsedMs = now - accord.entered_current_status_at.getTime();

        if (elapsedMs < thresholdMs) continue;

        // Idempotency check
        const existingLog = await prisma.salesAutomationLog.findUnique({
          where: { rule_id_accord_id: { rule_id: rule.id, accord_id: accord.id } },
        });

        if (existingLog) continue;

        const result = await executeRule(rule, accord);
        summary.tasksFired += result.taskIds.length;

        if (!result.skipped) {
          console.log(
            `[sales-automation] Time-based rule "${rule.name}" fired for accord "${accord.name}" — ${result.taskIds.length} task(s) created`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(
          `[sales-automation] Error evaluating rule "${rule.name}" for accord "${accord.name}": ${message}`,
        );
        summary.errors.push(`Rule "${rule.name}" / Accord "${accord.name}": ${message}`);
      }
    }
  }

  console.log(
    `[sales-automation] Cron complete — rules: ${summary.rulesEvaluated}, accords: ${summary.accordsChecked}, tasks fired: ${summary.tasksFired}, errors: ${summary.errors.length}`,
  );

  return summary;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Execute a single rule against an accord: resolve assignees, create tasks,
 * and log the execution.
 */
async function executeRule(
  rule: SalesAutomationRuleWithUser,
  accord: AccordForAutomation,
): Promise<FiredRuleResult> {
  const assigneeIds = await resolveAssignee(rule, accord);

  if (assigneeIds.length === 0) {
    // Log even when no assignees so we don't re-evaluate
    await prisma.salesAutomationLog.create({
      data: { rule_id: rule.id, accord_id: accord.id },
    });

    return {
      ruleId: rule.id,
      ruleName: rule.name,
      taskIds: [],
      skipped: true,
      skipReason: 'no assignees resolved',
    };
  }

  const taskIds: string[] = [];

  for (const assigneeId of assigneeIds) {
    const taskId = await createTaskFromTemplate(rule, accord, assigneeId);
    taskIds.push(taskId);
  }

  // Log the first task id for reference (the log is 1:1 rule+accord)
  await prisma.salesAutomationLog.create({
    data: {
      rule_id: rule.id,
      accord_id: accord.id,
      task_id: taskIds[0] ?? null,
    },
  });

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    taskIds,
    skipped: false,
  };
}

/**
 * Resolve the assignee(s) for a rule based on the assignee_rule field.
 */
async function resolveAssignee(
  rule: SalesAutomationRuleWithUser,
  accord: AccordForAutomation,
): Promise<string[]> {
  switch (rule.assignee_rule) {
    case 'accord_owner':
      return [accord.owner_id];

    case 'meeting_attendees': {
      // Collect unique attendee IDs from all meetings linked to this accord
      const idSet = new Set<string>();
      for (const ma of accord.meeting_accords) {
        for (const att of ma.meeting.attendees) {
          idSet.add(att.user_id);
        }
      }
      const ids = [...idSet];
      return ids.length > 0 ? ids : [accord.owner_id]; // fallback to owner
    }

    case 'specific_user':
      return rule.assignee_user_id ? [rule.assignee_user_id] : [];

    default:
      console.log(`[sales-automation] Unknown assignee_rule "${rule.assignee_rule}" — falling back to accord owner`);
      return [accord.owner_id];
  }
}

/**
 * Create a task from a rule's task_template.
 */
async function createTaskFromTemplate(
  rule: SalesAutomationRuleWithUser,
  accord: AccordForAutomation,
  assigneeId: string,
): Promise<string> {
  const template = rule.task_template as unknown as TaskTemplate;

  // Interpolate accord name into the title
  const title = template.title.replace(/\{accord_name\}/g, accord.name);
  const description = template.description?.replace(/\{accord_name\}/g, accord.name) ?? null;

  const dueDate =
    template.due_offset_hours != null
      ? new Date(Date.now() + template.due_offset_hours * 60 * 60 * 1000)
      : null;

  const task = await prisma.task.create({
    data: {
      title,
      description,
      priority: template.priority ?? 3,
      assignee_id: assigneeId,
      function_id: template.function_id ?? null,
      accord_id: accord.id,
      due_date: dueDate,
      status: 'not_started',
    },
  });

  return task.id;
}
