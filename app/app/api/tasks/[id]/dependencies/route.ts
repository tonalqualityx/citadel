import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

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
    if (task.status !== 'blocked' && blocker.status !== 'done') {
      await prisma.task.update({
        where: { id },
        data: { status: 'blocked' },
      });
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

    // Check if task still has blockers
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        blocked_by: {
          where: { status: { not: 'done' } },
          select: { id: true },
        },
      },
    });

    // If no more active blockers and task is blocked, reset to not_started
    if (task && task.status === 'blocked' && task.blocked_by.length === 0) {
      await prisma.task.update({
        where: { id },
        data: { status: 'not_started' },
      });
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
