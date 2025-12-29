import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@prisma/client';

export type ActivityAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'assigned'
  | 'unassigned'
  | 'completed'
  | 'commented';

export type EntityType = 'task' | 'project' | 'client' | 'site' | 'sop' | 'comment';

export interface ActivityLogInput {
  userId: string;
  action: ActivityAction;
  entityType: EntityType;
  entityId: string;
  entityName?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

/**
 * Log an activity to the activity log
 */
export async function logActivity(input: ActivityLogInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        user_id: input.userId,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId,
        entity_name: input.entityName,
        changes: input.changes ? (input.changes as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
  } catch (error) {
    // Log but don't throw - activity logging should not break main operations
    console.error('Failed to log activity:', error);
  }
}

/**
 * Log a create action
 */
export async function logCreate(
  userId: string,
  entityType: EntityType,
  entityId: string,
  entityName?: string
): Promise<void> {
  return logActivity({
    userId,
    action: 'created',
    entityType,
    entityId,
    entityName,
  });
}

/**
 * Log an update action with changes
 */
export async function logUpdate(
  userId: string,
  entityType: EntityType,
  entityId: string,
  entityName: string,
  changes: Record<string, { from: unknown; to: unknown }>
): Promise<void> {
  // Only log if there are actual changes
  if (Object.keys(changes).length === 0) return;

  return logActivity({
    userId,
    action: 'updated',
    entityType,
    entityId,
    entityName,
    changes,
  });
}

/**
 * Log a delete action
 */
export async function logDelete(
  userId: string,
  entityType: EntityType,
  entityId: string,
  entityName?: string
): Promise<void> {
  return logActivity({
    userId,
    action: 'deleted',
    entityType,
    entityId,
    entityName,
  });
}

/**
 * Log a status change action
 */
export async function logStatusChange(
  userId: string,
  entityType: EntityType,
  entityId: string,
  entityName: string,
  fromStatus: string,
  toStatus: string
): Promise<void> {
  return logActivity({
    userId,
    action: 'status_changed',
    entityType,
    entityId,
    entityName,
    changes: {
      status: { from: fromStatus, to: toStatus },
    },
  });
}

/**
 * Log an assignment action
 */
export async function logAssignment(
  userId: string,
  entityType: EntityType,
  entityId: string,
  entityName: string,
  assigneeId: string | null,
  previousAssigneeId: string | null
): Promise<void> {
  return logActivity({
    userId,
    action: assigneeId ? 'assigned' : 'unassigned',
    entityType,
    entityId,
    entityName,
    changes: {
      assignee_id: { from: previousAssigneeId, to: assigneeId },
    },
  });
}

/**
 * Helper to detect changes between old and new objects
 */
export function detectChanges(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  fieldsToTrack: string[]
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of fieldsToTrack) {
    const oldValue = oldData[field];
    const newValue = newData[field];

    // Check if values are different
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[field] = { from: oldValue, to: newValue };
    }
  }

  return changes;
}
