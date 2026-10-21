import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { requireEngine } from '@/lib/engine/auth';
import { recordRunnerHeartbeat } from '@/lib/portal/chat/switches';

// POST /api/engine/runner/heartbeat (portal phase C, engine scope)
// The runner is alive. Every 60 seconds from its poll loop, idle or busy. Chat availability reads this
// (dead = none for 3 minutes), not the claims, so the first message after a quiet night stays in model mode.
export async function POST() {
  try {
    await requireEngine();
    const seen = await recordRunnerHeartbeat();
    return NextResponse.json({ seen_at: seen });
  } catch (error) {
    return handleApiError(error);
  }
}
