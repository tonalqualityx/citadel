import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { attachBodySchema, attachItem } from '@/lib/initiatives/attach';

// POST /api/initiatives/[id]/attach - link one project or one task to this initiative (exactly one of project_id, task_id)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const body = attachBodySchema.parse(await request.json());
    return NextResponse.json(await attachItem(id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
