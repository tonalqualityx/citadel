import { NextRequest } from 'next/server';
import { GET as stateGet } from '../../../[key]/state/route';

/**
 * Work stage D: GET /api/work/task/:id/state, the same answer as /api/work/task:<id>/state, under the path the worker's spawn gate reads
 * (the plan names both). A live session attached to the task is `live_session: true`: the worker keeps off.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return stateGet(request, { params: Promise.resolve({ key: `task:${id}` }) });
}
