import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireWorker } from '@/lib/design/worker-kit';
import { buildInbox } from '@/lib/design/worker-inbox';

export async function GET(request: NextRequest) {
  try {
    await requireWorker();
    const max = Number(new URL(request.url).searchParams.get('max') ?? 50);
    return NextResponse.json(await buildInbox({ max: Number.isFinite(max) ? max : 50 }));
  } catch (error) {
    return handleApiError(error);
  }
}
