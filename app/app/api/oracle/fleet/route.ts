import { NextRequest, NextResponse } from 'next/server';
import { OracleSessionStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import {
  isMachineStale,
  COMMAND_RECENT_HOURS,
  COMMAND_RECENT_CAP,
  STALE_HIDE_MINUTES,
} from '@/lib/oracle/helpers';

// Ended sessions older than this fall out of the fleet response entirely (the UI's
// "Recently ended" group only needs a short tail, not the full history — that lives in
// the event log / a future detail view).
const RECENT_ENDED_HOURS = 24;

// `request` is optional so existing no-arg callers (pre-Clarity-Phase-1) keep working —
// only `?include_archived=true` needs the URL, and its absence just means "not requested".
export async function GET(request?: NextRequest) {
  try {
    const auth = await requireAuth();
    // 1.5a: Oracle is admin-only everywhere it was previously pm-or-admin. The oracle
    // service bot (role pm) is unaffected — it never calls this route, only ingest,
    // which authorizes via isOracleBot, not role.
    requireRole(auth, ['admin']);

    const includeArchived = request
      ? new URL(request.url).searchParams.get('include_archived') === 'true'
      : false;

    const now = new Date();
    const recentEndedCutoff = new Date(now.getTime() - RECENT_ENDED_HOURS * 60 * 60 * 1000);
    const recentCommandCutoff = new Date(now.getTime() - COMMAND_RECENT_HOURS * 60 * 60 * 1000);
    const staleHideCutoff = new Date(now.getTime() - STALE_HIDE_MINUTES * 60 * 1000);

    const machines = await prisma.oracleMachine.findMany({
      orderBy: { name: 'asc' },
      include: {
        sessions: {
          where: {
            AND: [
              {
                OR: [
                  {
                    status: {
                      in: [OracleSessionStatus.running, OracleSessionStatus.waiting, OracleSessionStatus.idle],
                    },
                  },
                  // Read-time cleanup (Phase 2): a stale session only stays visible for
                  // STALE_HIDE_MINUTES after its last event — long-dead junk (e.g. old
                  // heartbeat-bug subagent rows) ages out of the response without ever
                  // being deleted. Recently-stale sessions (a machine that just dropped)
                  // still show up.
                  { status: OracleSessionStatus.stale, last_event_at: { gte: staleHideCutoff } },
                  { status: OracleSessionStatus.ended, ended_at: { gte: recentEndedCutoff } },
                ],
              },
              // Clarity Phase 1: archived sessions (archived_at set) are excluded from the
              // default fleet response entirely; ?include_archived=true restores them.
              ...(includeArchived ? [] : [{ archived_at: null }]),
            ],
          },
          orderBy: [{ last_event_at: 'desc' }],
          include: {
            agents: { orderBy: { created_at: 'asc' } },
          },
        },
        commands: {
          where: { created_at: { gte: recentCommandCutoff } },
          orderBy: { created_at: 'desc' },
          take: COMMAND_RECENT_CAP,
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
          remote_url: session.remote_url,
          status: session.status,
          needs_attention: session.needs_attention,
          attention_reason: session.attention_reason,
          started_at: session.started_at,
          last_event_at: session.last_event_at,
          ended_at: session.ended_at,
          tokens_total: session.tokens_total,
          // Clarity Phase 1: session meaning + arc + archive state.
          session_type: session.session_type,
          goal: session.goal,
          waiting_on: session.waiting_on,
          ask_queue: session.ask_queue,
          ask_severity: session.ask_severity,
          arc_id: session.arc_id,
          archived_at: session.archived_at,
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
        commands: machine.commands.map((cmd) => {
          const payload = (cmd.payload ?? {}) as Record<string, unknown>;
          return {
            id: cmd.id,
            verb: cmd.verb,
            status: cmd.status,
            title: typeof payload.title === 'string' ? payload.title : null,
            cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
            created_at: cmd.created_at,
            completed_at: cmd.completed_at,
            result: cmd.result,
            error: cmd.error,
          };
        }),
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
