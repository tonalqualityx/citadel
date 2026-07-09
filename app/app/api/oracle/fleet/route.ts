import { NextResponse } from 'next/server';
import { OracleSessionStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { isMachineStale } from '@/lib/oracle/helpers';

// Ended sessions older than this fall out of the fleet response entirely (the UI's
// "Recently ended" group only needs a short tail, not the full history — that lives in
// the event log / a future detail view).
const RECENT_ENDED_HOURS = 24;

export async function GET() {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const now = new Date();
    const recentEndedCutoff = new Date(now.getTime() - RECENT_ENDED_HOURS * 60 * 60 * 1000);

    const machines = await prisma.oracleMachine.findMany({
      orderBy: { name: 'asc' },
      include: {
        sessions: {
          where: {
            OR: [
              {
                status: {
                  in: [OracleSessionStatus.running, OracleSessionStatus.waiting, OracleSessionStatus.stale],
                },
              },
              { status: OracleSessionStatus.ended, ended_at: { gte: recentEndedCutoff } },
            ],
          },
          orderBy: [{ last_event_at: 'desc' }],
          include: {
            agents: { orderBy: { created_at: 'asc' } },
          },
        },
      },
    });

    let totalSessions = 0;
    let totalAgents = 0;

    const shapedMachines = machines.map((machine) => {
      totalSessions += machine.sessions.length;
      const agentCount = machine.sessions.reduce((sum, s) => sum + s.agents.length, 0);
      totalAgents += agentCount;

      return {
        id: machine.id,
        name: machine.name,
        hostname: machine.hostname,
        last_heartbeat_at: machine.last_heartbeat_at,
        stale: isMachineStale(machine.last_heartbeat_at, now),
        sessions: machine.sessions.map((session) => ({
          id: session.id,
          external_id: session.external_id,
          source: session.source,
          title: session.title,
          cwd: session.cwd,
          model: session.model,
          status: session.status,
          needs_attention: session.needs_attention,
          attention_reason: session.attention_reason,
          started_at: session.started_at,
          last_event_at: session.last_event_at,
          ended_at: session.ended_at,
          tokens_total: session.tokens_total,
          agents: session.agents.map((agent) => ({
            id: agent.id,
            external_id: agent.external_id,
            label: agent.label,
            phase: agent.phase,
            model: agent.model,
            status: agent.status,
            activity: agent.activity,
            tokens: agent.tokens,
            duration_ms: agent.duration_ms,
            started_at: agent.started_at,
            ended_at: agent.ended_at,
          })),
        })),
      };
    });

    return NextResponse.json({
      machines: shapedMachines,
      counts: { machines: shapedMachines.length, sessions: totalSessions, agents: totalAgents },
      generated_at: now.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
