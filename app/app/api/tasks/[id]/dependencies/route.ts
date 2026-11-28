import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { notifyReleasedAssignees } from '@/lib/services/notifications';
import { isReviewStep } from '@/lib/tasks/review-coverage';
import { dropStampsCoveredBy } from '@/lib/tasks/review-coverage-db';

const addDependencySchema = z.object({
  blocker_id: z.string().uuid(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = addDependencySchema.parse(body);

    // Verify both tasks exist
    const [task, blocker] = await Promise.all([
      prisma.task.findUnique({ where: { id, is_deleted: false } }),
      prisma.task.findUnique({ where: { id: data.blocker_id, is_deleted: false } }),
    ]);

    if (!task) {
      throw new ApiError('Task not found', 404);
    }
    if (!blocker) {
      throw new ApiError('Blocker task not found', 404);
    }

    // Prevent self-reference
    if (id === data.blocker_id) {
      throw new ApiError('A task cannot block itself', 400);
    }

    // Check for circular dependency
    const blockerChain = await getBlockerChain(data.blocker_id);
    if (blockerChain.includes(id)) {
      throw new ApiError('This would create a circular dependency', 400);
    }

    // Add the dependency
    await prisma.task.update({
      where: { id },
      data: {
        blocked_by: {
          connect: { id: data.blocker_id },
        },
      },
    });

    // Optionally set task status to blocked if not already
    // A triage task is parked for Mike: a new blocker never changes its status (the blockers keep the order once it is released).
    if (task.status !== 'blocked' && task.status !== 'triage' && blocker.status !== 'done') {
      await prisma.task.update({
        where: { id },
        data: { status: 'blocked' },
      });
    }

    // A review step just gained a blocker: the done, unapproved pieces it now covers lose their per-piece review stamp (the review step is the review).
    if (isReviewStep(task.tags)) {
      try {
        await dropStampsCoveredBy(id);
      } catch (e) {
        console.error('drop covered review stamps failed', id, e);
      }
    }

    return NextResponse.json({ success: true }, { status: 201 });
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
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const blockerId = searchParams.get('blocker_id');

    if (!blockerId) {
      throw new ApiError('blocker_id is required', 400);
    }

    await prisma.task.update({
      where: { id },
      data: {
        blocked_by: {
          disconnect: { id: blockerId },
        },
      },
    });

    // If no unfinished blocker task and no open question holds it any more, a blocked task goes back to not_started
    // (the same predicate as the unblock sweep: lib/services/dependencies.ts).
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        blocked_by: {
          where: { status: { not: 'done' } },
          select: { id: true },
        },
        blocked_by_questions: { where: { state: 'open' }, select: { id: true } },
      },
    });

    if (task && task.status === 'blocked' && task.blocked_by.length === 0 && task.blocked_by_questions.length === 0) {
      await prisma.task.update({
        where: { id },
        data: { status: 'not_started' },
      });
      // Released: the assignment notice it held while blocked goes out, once (task 5ad27fc9). It never fails the call.
      try {
        await notifyReleasedAssignees([id]);
      } catch (e) {
        console.error('held assignment notice failed', id, e);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

// Helper to get all blockers recursively (for circular dependency check)
async function getBlockerChain(taskId: string, visited: Set<string> = new Set()): Promise<string[]> {
  if (visited.has(taskId)) return [];
  visited.add(taskId);

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      blocked_by: { select: { id: true } },
    },
  });

  if (!task) return [];

  const chain: string[] = [taskId];
  for (const blocker of task.blocked_by) {
    const subChain = await getBlockerChain(blocker.id, visited);
    chain.push(...subChain);
  }

  return chain;
}
