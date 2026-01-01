import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';

const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  email: z.string().email('Invalid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  role: z.enum(['tech', 'pm', 'admin']).default('tech'),
  avatar_url: z.string().url().max(500).optional().nullable(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role');
    const includeInactive = searchParams.get('include_inactive') === 'true';

    const where: Record<string, unknown> = {};

    if (!includeInactive) {
      where.is_active = true;
    }

    if (role) {
      where.role = role;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        is_active: true,
        avatar_url: true,
        last_login_at: true,
        target_hours_per_week: true,
        created_at: true,
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ users });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['admin']);

    const body = await request.json();
    const data = createUserSchema.parse(body);

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ApiError('A user with this email already exists', 400);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password_hash: passwordHash,
        role: data.role,
        avatar_url: data.avatar_url || null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        is_active: true,
        avatar_url: true,
        created_at: true,
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
