import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatUserFunctionResponse } from '@/lib/api/formatters';

const addUserFunctionSchema = z.object({
  function_id: z.string().uuid(),
  is_primary: z.boolean().optional().default(false),
});

// GET /api/users/[id]/functions - Get all functions for a user
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id } = await params;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      throw new ApiError('User not found', 404);
    }

    const userFunctions = await prisma.userFunction.findMany({
      where: { user_id: id },
      include: {
        function: { select: { id: true, name: true } },
      },
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
    });

    return NextResponse.json({
      user_functions: userFunctions.map(formatUserFunctionResponse),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST /api/users/[id]/functions - Add a function to a user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;

    const body = await request.json();
    const data = addUserFunctionSchema.parse(body);

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id },
    });
    if (!user) {
      throw new ApiError('User not found', 404);
    }

    // Verify function exists
    const func = await prisma.function.findUnique({
      where: { id: data.function_id, is_active: true },
    });
    if (!func) {
      throw new ApiError('Function not found', 404);
    }

    // Check if already assigned
    const existing = await prisma.userFunction.findUnique({
      where: {
        user_id_function_id: {
          user_id: id,
          function_id: data.function_id,
        },
      },
    });
    if (existing) {
      throw new ApiError('User already has this function', 400);
    }

    // If setting as primary, unset any existing primary
    if (data.is_primary) {
      await prisma.userFunction.updateMany({
        where: { user_id: id, is_primary: true },
        data: { is_primary: false },
      });
    }

    const userFunction = await prisma.userFunction.create({
      data: {
        user_id: id,
        function_id: data.function_id,
        is_primary: data.is_primary,
      },
      include: {
        function: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(formatUserFunctionResponse(userFunction), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

// DELETE /api/users/[id]/functions?function_id=X - Remove a function from a user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const functionId = searchParams.get('function_id');

    if (!functionId) {
      throw new ApiError('function_id is required', 400);
    }

    await prisma.userFunction.delete({
      where: {
        user_id_function_id: {
          user_id: id,
          function_id: functionId,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

// PATCH /api/users/[id]/functions?function_id=X - Update a user function (e.g., set primary)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const functionId = searchParams.get('function_id');

    if (!functionId) {
      throw new ApiError('function_id is required', 400);
    }

    const body = await request.json();
    const { is_primary } = body;

    if (typeof is_primary !== 'boolean') {
      throw new ApiError('is_primary must be a boolean', 400);
    }

    // If setting as primary, unset any existing primary
    if (is_primary) {
      await prisma.userFunction.updateMany({
        where: { user_id: id, is_primary: true },
        data: { is_primary: false },
      });
    }

    const userFunction = await prisma.userFunction.update({
      where: {
        user_id_function_id: {
          user_id: id,
          function_id: functionId,
        },
      },
      data: { is_primary },
      include: {
        function: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(formatUserFunctionResponse(userFunction));
  } catch (error) {
    return handleApiError(error);
  }
}
