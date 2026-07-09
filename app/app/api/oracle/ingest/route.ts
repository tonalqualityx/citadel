import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma, OracleSource, OracleSessionStatus } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import {
  isOracleBot,
  RECONCILE_STALE_MINUTES,
  EVENT_RETENTION_DAYS,
  MAX_EVENTS_PER_INGEST,
  MAX_PAYLOAD_BYTES,
} from '@/lib/oracle/helpers';

// Hard ceiling on the whole request body — protects against a runaway/misbehaving local
// client. Individual event/agent payloads are additionally capped (MAX_PAYLOAD_BYTES).
const MAX_BODY_BYTES = 2_000_000;

function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? {}), 'utf8');
  } catch {
    return Infinity;
  }
}

const jsonPayloadSchema = z
  .record(z.string(), z.unknown())
  .refine((p) => byteLength(p) <= MAX_PAYLOAD_BYTES, {
    message: `payload exceeds ${MAX_PAYLOAD_BYTES} bytes`,
  });

const sourceSchema = z.nativeEnum(OracleSource);
const sessionStatusSchema = z.nativeEnum(OracleSessionStatus);

// Events come straight off Claude Code hooks / the heartbeat spool. `status` is
// intentionally NOT client-settable here — session status is server-derived from `kind`
// (see deriveSessionUpdate below). Unknown kinds are accepted and simply logged; ingest
// must never throw on an unrecognized event kind.
const eventInSchema = z.object({
  kind: z.string().min(1).max(100),
  external_id: z.string().min(1).max(255),
  source: sourceSchema,
  ts: z.coerce.date(),
  title: z.string().max(500).optional(),
  cwd: z.string().max(1000).optional(),
  model: z.string().max(100).optional(),
  tokens_total: z.number().int().min(0).max(1_000_000_000).optional(),
  payload: jsonPayloadSchema.optional().default({}),
});

const agentInSchema = z.object({
  external_id: z.string().min(1).max(255),
  label: z.string().min(1).max(255),
  phase: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  status: z.string().min(1).max(50).default('queued'),
  activity: z.string().max(2000).optional(),
  tokens: z.number().int().min(0).max(1_000_000_000).optional(),
  duration_ms: z.number().int().min(0).optional(),
  started_at: z.coerce.date().optional(),
  ended_at: z.coerce.date().optional(),
});

// The snapshot is the heartbeat's authoritative state — unlike events, `status` IS
// directly settable here (the heartbeat has already determined running/waiting/ended by
// inspecting live processes / transcripts / wf_*.json / cron list).
const snapshotSessionSchema = z.object({
  external_id: z.string().min(1).max(255),
  source: sourceSchema,
  title: z.string().max(500).optional(),
  cwd: z.string().max(1000).optional(),
  model: z.string().max(100).optional(),
  status: sessionStatusSchema.optional(),
  needs_attention: z.boolean().optional(),
  attention_reason: z.string().max(2000).optional(),
  started_at: z.coerce.date().optional(),
  last_event_at: z.coerce.date().optional(),
  ended_at: z.coerce.date().optional(),
  tokens_total: z.number().int().min(0).max(1_000_000_000).optional(),
  meta: jsonPayloadSchema.optional(),
  agents: z.array(agentInSchema).max(200).optional().default([]),
});

const snapshotSchema = z.object({
  sessions: z.array(snapshotSessionSchema).max(500),
});

const ingestBodySchema = z.object({
  machine: z.object({
    name: z.string().min(1).max(255),
    hostname: z.string().max(255).optional(),
  }),
  sent_at: z.coerce.date().optional(),
  events: z.array(eventInSchema).max(MAX_EVENTS_PER_INGEST).optional().default([]),
  snapshot: snapshotSchema.optional(),
});

type SessionRow = {
  id: string;
  source: OracleSource;
  external_id: string;
  status: OracleSessionStatus;
  last_event_at: Date | null;
  updated_at: Date;
};

// Server-derived status semantics (spec): running = UserPromptSubmit after last Stop;
// waiting = Stop fired; needs_attention set by Notification, cleared on next
// UserPromptSubmit; ended = SessionEnd. Unrecognized kinds fall through untouched —
// the event is still logged, ingest never crashes on an unknown kind.
function deriveSessionUpdate(
  kind: string,
  evt: { ts: Date; payload: Record<string, unknown> }
): Record<string, unknown> {
  switch (kind) {
    case 'UserPromptSubmit':
      return { status: OracleSessionStatus.running, needs_attention: false, attention_reason: null };
    case 'Stop':
      return { status: OracleSessionStatus.waiting };
    case 'SessionEnd':
      return { status: OracleSessionStatus.ended, ended_at: evt.ts };
    case 'SessionStart':
      return { status: OracleSessionStatus.running };
    case 'Notification': {
      const message =
        typeof evt.payload?.message === 'string'
          ? (evt.payload.message as string).slice(0, 2000)
          : 'Needs attention';
      return { needs_attention: true, attention_reason: message };
    }
    default:
      return {};
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (!isOracleBot(auth)) {
      throw new ApiError('Oracle ingest is machine-only', 403);
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      throw new ApiError('Request body too large', 413);
    }

    let json: unknown;
    try {
      json = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new ApiError('Invalid JSON body', 400);
    }

    const data = ingestBodySchema.parse(json);

    const now = new Date();
    const heartbeatAt = data.sent_at ?? now;

    const machine = await prisma.oracleMachine.upsert({
      where: { name: data.machine.name },
      create: {
        name: data.machine.name,
        hostname: data.machine.hostname,
        last_heartbeat_at: heartbeatAt,
      },
      update: {
        ...(data.machine.hostname !== undefined && { hostname: data.machine.hostname }),
        last_heartbeat_at: heartbeatAt,
      },
    });

    // Per-call session cache — avoids re-querying for every event in a batch that
    // targets the same session (hooks fire many events per turn).
    const sessionCache = new Map<string, SessionRow>();
    const cacheKey = (source: OracleSource, externalId: string) => `${source}:${externalId}`;

    async function loadSession(source: OracleSource, externalId: string): Promise<SessionRow | null> {
      const key = cacheKey(source, externalId);
      if (sessionCache.has(key)) return sessionCache.get(key)!;
      const existing = await prisma.oracleSession.findUnique({
        where: { machine_id_source_external_id: { machine_id: machine.id, source, external_id: externalId } },
      });
      if (existing) sessionCache.set(key, existing);
      return existing;
    }

    let eventsIngested = 0;

    for (const evt of data.events) {
      const existing = await loadSession(evt.source, evt.external_id);
      const derived = deriveSessionUpdate(evt.kind, { ts: evt.ts, payload: evt.payload ?? {} });
      const baseFields: Record<string, unknown> = {
        ...(evt.title !== undefined && { title: evt.title }),
        ...(evt.cwd !== undefined && { cwd: evt.cwd }),
        ...(evt.model !== undefined && { model: evt.model }),
        ...(evt.tokens_total !== undefined && { tokens_total: evt.tokens_total }),
      };

      let sessionId: string;
      if (!existing) {
        const created = await prisma.oracleSession.create({
          data: {
            machine_id: machine.id,
            source: evt.source,
            external_id: evt.external_id,
            started_at: evt.ts,
            last_event_at: evt.ts,
            ...baseFields,
            ...derived,
          },
        });
        sessionId = created.id;
        sessionCache.set(cacheKey(evt.source, evt.external_id), created);
      } else {
        const updated = await prisma.oracleSession.update({
          where: { id: existing.id },
          data: {
            last_event_at: evt.ts,
            ...baseFields,
            ...derived,
          },
        });
        sessionId = updated.id;
        sessionCache.set(cacheKey(evt.source, evt.external_id), updated);
      }

      await prisma.oracleEvent.create({
        data: {
          session_id: sessionId,
          machine_id: machine.id,
          kind: evt.kind,
          payload: (evt.payload ?? {}) as Prisma.InputJsonValue,
          ts: evt.ts,
        },
      });
      eventsIngested++;
    }

    let sessionsUpserted = 0;
    let agentsUpserted = 0;
    let reconciledStale = 0;

    if (data.snapshot) {
      const snapshotKeys = new Set<string>();

      for (const snap of data.snapshot.sessions) {
        snapshotKeys.add(cacheKey(snap.source, snap.external_id));

        const existing = await loadSession(snap.source, snap.external_id);
        const fields: Record<string, unknown> = {
          ...(snap.title !== undefined && { title: snap.title }),
          ...(snap.cwd !== undefined && { cwd: snap.cwd }),
          ...(snap.model !== undefined && { model: snap.model }),
          ...(snap.status !== undefined && { status: snap.status }),
          ...(snap.needs_attention !== undefined && { needs_attention: snap.needs_attention }),
          ...(snap.attention_reason !== undefined && { attention_reason: snap.attention_reason }),
          ...(snap.started_at !== undefined && { started_at: snap.started_at }),
          ...(snap.ended_at !== undefined && { ended_at: snap.ended_at }),
          ...(snap.tokens_total !== undefined && { tokens_total: snap.tokens_total }),
          ...(snap.meta !== undefined && { meta: snap.meta as Prisma.InputJsonValue }),
          last_event_at: snap.last_event_at ?? now,
        };

        let sessionRow: SessionRow;
        if (!existing) {
          sessionRow = await prisma.oracleSession.create({
            data: {
              machine_id: machine.id,
              source: snap.source,
              external_id: snap.external_id,
              started_at: snap.started_at ?? now,
              ...fields,
            },
          });
        } else {
          sessionRow = await prisma.oracleSession.update({
            where: { id: existing.id },
            data: fields,
          });
        }
        sessionCache.set(cacheKey(snap.source, snap.external_id), sessionRow);
        sessionsUpserted++;

        for (const agent of snap.agents ?? []) {
          await prisma.oracleAgent.upsert({
            where: {
              session_id_external_id: { session_id: sessionRow.id, external_id: agent.external_id },
            },
            create: {
              session_id: sessionRow.id,
              external_id: agent.external_id,
              label: agent.label,
              phase: agent.phase,
              model: agent.model,
              status: agent.status,
              activity: agent.activity,
              tokens: agent.tokens ?? 0,
              duration_ms: agent.duration_ms,
              started_at: agent.started_at,
              ended_at: agent.ended_at,
            },
            update: {
              label: agent.label,
              ...(agent.phase !== undefined && { phase: agent.phase }),
              ...(agent.model !== undefined && { model: agent.model }),
              status: agent.status,
              ...(agent.activity !== undefined && { activity: agent.activity }),
              ...(agent.tokens !== undefined && { tokens: agent.tokens }),
              ...(agent.duration_ms !== undefined && { duration_ms: agent.duration_ms }),
              ...(agent.started_at !== undefined && { started_at: agent.started_at }),
              ...(agent.ended_at !== undefined && { ended_at: agent.ended_at }),
            },
          });
          agentsUpserted++;
        }
      }

      // Reconciliation: any session we had as running/waiting that is absent from this
      // snapshot and hasn't been heard from in RECONCILE_STALE_MINUTES is presumed dead.
      const cutoff = new Date(now.getTime() - RECONCILE_STALE_MINUTES * 60_000);
      const candidates = await prisma.oracleSession.findMany({
        where: {
          machine_id: machine.id,
          status: { in: [OracleSessionStatus.running, OracleSessionStatus.waiting] },
        },
        select: { id: true, source: true, external_id: true, last_event_at: true, updated_at: true },
      });
      const staleIds = candidates
        .filter((s) => {
          if (snapshotKeys.has(cacheKey(s.source, s.external_id))) return false;
          const referenceTime = s.last_event_at ?? s.updated_at;
          return referenceTime < cutoff;
        })
        .map((s) => s.id);

      if (staleIds.length > 0) {
        await prisma.oracleSession.updateMany({
          where: { id: { in: staleIds } },
          data: { status: OracleSessionStatus.stale },
        });
        reconciledStale = staleIds.length;
      }
    }

    // Opportunistic pruning — best-effort, never fails the ingest response.
    let prunedEvents = 0;
    try {
      const pruneCutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const pruned = await prisma.oracleEvent.deleteMany({ where: { ts: { lt: pruneCutoff } } });
      prunedEvents = pruned.count;
    } catch (pruneError) {
      console.error('Oracle event prune failed (non-fatal):', pruneError);
    }

    return NextResponse.json({
      success: true,
      machine_id: machine.id,
      events_ingested: eventsIngested,
      sessions_upserted: sessionsUpserted,
      agents_upserted: agentsUpserted,
      reconciled_stale: reconciledStale,
      pruned_events: prunedEvents,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
