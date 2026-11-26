import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { attachBodySchema, detachItem } from '@/lib/initiatives/attach';

// POST /api/initiatives/[id]/detach - unlink one project or one task, only when it points at this initiative (409 otherwise)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { id } = await params;
    const body = attachBodySchema.parse(await request.json());
    return NextResponse.json(await detachItem(id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
