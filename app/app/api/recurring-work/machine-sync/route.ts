import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { machineSyncSchema, syncMachineJobs } from '@/lib/recurring-work/machine-sync';

// POST /api/recurring-work/machine-sync - the machine's full job list; upserts by job_key, deactivates what is missing
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const { jobs } = machineSyncSchema.parse(await request.json());
    return NextResponse.json(await syncMachineJobs(jobs));
  } catch (error) {
    return handleApiError(error);
  }
}
