/**
 * The tool-call log (phase C spec 5.4). The MCP server posts every call here BEFORE it returns the
 * result to the model; if this route refuses, the tool returns an error instead of data. The
 * numbers each result carried are stored in `result_numbers` for the gate's provenance check.
 * The caps live here too, in the database, so a restart changes nothing: 6 calls a job and 40
 * analytics calls a client a day (spec 9.3).
 */
import { Prisma, type EngineJob } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';
import { buildProvenance, extractResultNumbers, type Provenance, type ProvenanceCall } from '@/lib/portal/chat/provenance';

export const TOOLS = ['ga4_report', 'search_console', 'citadel_read', 'site_pages'] as const;
export type ToolName = (typeof TOOLS)[number];
export const ANALYTICS_TOOLS: readonly string[] = ['ga4_report', 'search_console'];
export const MAX_CALLS_PER_JOB = 6;
export const MAX_ANALYTICS_PER_CLIENT_DAY = 40;
export const RESULT_CAP_BYTES = 20_000;

export interface ToolCallInput {
  tool: ToolName;
  args: Record<string, unknown>;
  row_count?: number | null;
  latency_ms?: number | null;
  error?: string | null;
  result?: unknown;
}

/** The result as stored: whole when it fits, otherwise a marker, the range label and a preview. */
export function capResult(result: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (result === undefined || result === null) return Prisma.JsonNull;
  const text = JSON.stringify(result);
  if (text.length <= RESULT_CAP_BYTES) return result as Prisma.InputJsonValue;
  const label = typeof (result as { label?: unknown }).label === 'string' ? (result as { label: string }).label : null;
  return { truncated: true, bytes: text.length, ...(label ? { label } : {}), preview: text.slice(0, 2000) };
}

type Db = Pick<Prisma.TransactionClient, 'engineToolCall'>;

/**
 * The caps, in one place: 6 calls a job, 40 analytics calls a client a day (spec 9.3). Throws a 429
 * ApiError when a cap is hit. `logToolCall` runs it under the lock when it writes; the preflight route
 * runs it BEFORE the tool server spends a Google call, so the daily cap stops the call, not just the log.
 */
export async function assertToolQuota(db: Db, job: Pick<EngineJob, 'id' | 'client_id'>, tool: string, now: Date = new Date()) {
  if (!job.client_id) throw new ApiError('Job has no client', 409);
  const used = await db.engineToolCall.count({ where: { job_id: job.id } });
  if (used >= MAX_CALLS_PER_JOB) throw new ApiError(`At most ${MAX_CALLS_PER_JOB} tool calls a job`, 429);
  if (ANALYTICS_TOOLS.includes(tool)) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const today = await db.engineToolCall.count({
      where: { client_id: job.client_id, tool: { in: [...ANALYTICS_TOOLS] }, created_at: { gte: since } },
    });
    if (today >= MAX_ANALYTICS_PER_CLIENT_DAY) {
      throw new ApiError(`At most ${MAX_ANALYTICS_PER_CLIENT_DAY} analytics calls a client a day`, 429);
    }
  }
}

export async function logToolCall(job: EngineJob, input: ToolCallInput, now: Date = new Date()) {
  if (!job.client_id) throw new ApiError('Job has no client', 409);
  const clientId = job.client_id;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`engine-tools:${job.id}`}))`;
    if (ANALYTICS_TOOLS.includes(input.tool)) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`engine-analytics:${clientId}`}))`;
    await assertToolQuota(tx, job, input.tool, now);
    return tx.engineToolCall.create({
      data: {
        job_id: job.id,
        task_id: job.task_id,
        conversation_id: job.conversation_id,
        client_id: clientId,
        tool: input.tool,
        args: input.args as Prisma.InputJsonValue,
        row_count: input.row_count ?? null,
        latency_ms: input.latency_ms ?? null,
        error: input.error ?? null,
        result: capResult(input.result),
        // Numbers come from the FULL result, which is what the model saw, not the stored cap.
        result_numbers: input.error ? [] : extractResultNumbers(input.result),
      },
    });
  });
}

/** The provenance for one job: what its logged tool calls (and the context bundle) can back. */
export async function loadJobProvenance(jobId: string, contextNumbers: string[] = [], clientTexts: string[] = []): Promise<Provenance> {
  const rows = await prisma.engineToolCall.findMany({
    where: { job_id: jobId, error: null },
    select: { tool: true, args: true, result: true, result_numbers: true },
    orderBy: { created_at: 'asc' },
  });
  const calls: ProvenanceCall[] = rows.map((r) => ({
    tool: r.tool,
    kind: typeof (r.args as { kind?: unknown } | null)?.kind === 'string' ? ((r.args as { kind: string }).kind) : undefined,
    result_numbers: r.result_numbers,
    label: typeof (r.result as { label?: unknown } | null)?.label === 'string' ? ((r.result as { label: string }).label) : null,
  }));
  return buildProvenance(calls, contextNumbers, clientTexts);
}
