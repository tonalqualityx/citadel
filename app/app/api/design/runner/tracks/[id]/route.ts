import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireTrackRunner } from '@/lib/design/runner-kit';
import { idParam } from '@/lib/design/worker-kit';
import { parseIncludes, readTrack } from '@/lib/design/track-runner';

// GET /api/design/runner/tracks/:id?include=brief,references,direction,client_statements,pages,imports,recipients
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireTrackRunner();
    const id = idParam((await params).id, 'Track not found');
    const includes = parseIncludes(request.nextUrl.searchParams.get('include'));
    return NextResponse.json(await readTrack(id, includes));
  } catch (error) {
    return handleApiError(error);
  }
}
