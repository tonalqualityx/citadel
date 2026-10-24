import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prismaSweepStore } from '@/lib/waits/prisma-store';
import { prismaOwnerLookups } from '@/lib/waits/owner';
import { resolveWaitOwner } from '@/lib/waits/sweeper';
import { serializeWait } from '@/lib/waits/serialize';
import { buildWaitData, TemplateError } from '@/lib/waits/templates';

const OPEN = ['waiting', 'needs_human', 'paused', 'blocked_by_switch'] as const;
const STATES = ['waiting', 'needs_human', 'paused', 'blocked_by_switch', 'done', 'expired'] as const;
const KINDS = ['approval', 'clock', 'handoff', 'meeting', 'external', 'switch'] as const;

const createSchema = z.object({
  template_key: z.string().min(1).max(80),
  subject: z.string().max(300).optional(),
  title: z.string().min(1).max(300).optional(),
  detail: z.string().max(5000).nullable().optional(),
  step: z.number().int().min(1).max(10).optional(),
  due_at: z.string().datetime({ offset: true }).optional(),
  duration: z
    .object({ value: z.number().int().min(0).max(365), unit: z.enum(['hours', 'calendar_days', 'business_days']) })
    .optional(),
  owner_function_id: z.string().uuid().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  owner_contact_id: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  accord_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  charter_id: z.string().uuid().nullable().optional(),
  site_id: z.string().uuid().nullable().optional(),
  task_id: z.string().uuid().nullable().optional(),
  arc_id: z.string().uuid().nullable().optional(),
  approval_request_id: z.string().uuid().nullable().optional(),
  email_thread_id: z.string().max(255).nullable().optional(),
  email_account: z.string().max(255).nullable().optional(),
  blocks_client: z.boolean().optional(),
  client_waiting_since: z.string().datetime({ offset: true }).nullable().optional(),
  action_payload: z.record(z.string(), z.unknown()).nullable().optional(),
  created_by_automation: z.string().max(80).optional(),
  idempotency_key: z.string().max(255).optional(),
  mike_only: z.boolean().nullable().optional(),
});

/**
 * GET /api/waits: list waits. Filters: state (default: open), kind, client_id, project_id,
 * task_id, charter_id, template_key, owner (a user id or "me": waits that resolve to that user),
 * limit (default 50, max 200).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const sp = new URL(request.url).searchParams;
    const state = sp.get('state');
    const kind = sp.get('kind');
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') || '50', 10) || 50));
    const ownerParam = sp.get('owner');
    const owner = ownerParam === 'me' ? auth.userId : ownerParam;

    if (state && state !== 'open' && !(STATES as readonly string[]).includes(state)) throw new ApiError('Unknown state', 400);
    if (kind && !(KINDS as readonly string[]).includes(kind)) throw new ApiError('Unknown kind', 400);

    const where = {
      state: !state || state === 'open' ? { in: [...OPEN] } : (state as (typeof STATES)[number]),
      ...(kind ? { kind: kind as (typeof KINDS)[number] } : {}),
      ...(sp.get('client_id') ? { client_id: sp.get('client_id')! } : {}),
      ...(sp.get('project_id') ? { project_id: sp.get('project_id')! } : {}),
      ...(sp.get('task_id') ? { task_id: sp.get('task_id')! } : {}),
      ...(sp.get('charter_id') ? { charter_id: sp.get('charter_id')! } : {}),
      ...(sp.get('template_key') ? { template_key: sp.get('template_key')! } : {}),
    };

    // The owner filter needs the resolved owner, so fetch wider and filter after resolving.
    const rows = await prisma.wait.findMany({ where, orderBy: { due_at: 'asc' }, take: owner ? 1000 : limit });
    const lookups = prismaOwnerLookups(prisma as unknown as Parameters<typeof prismaOwnerLookups>[0]);
    const out = [];
    for (const w of rows) {
      const resolved = await resolveWaitOwner(w, lookups);
      if (owner && resolved.user_id !== owner) continue;
      out.push(serializeWait(w, resolved));
      if (out.length >= limit) break;
    }
    return NextResponse.json({ data: out, meta: { count: out.length, limit } });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/waits: open a wait from a template. Phase 1 opens only the live templates
 * (build.gate_mike, build.review_internal, change.needs_human, meeting.type_unclear,
 * switch.off, handoff.generic) plus charter.price_review (step 1 only; the sweeper opens it too);
 * every other template is registered but refused. Idempotent on
 * idempotency_key: a repeat returns the existing wait with 200.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);
    const body = createSchema.parse(await request.json());
    // A price review chain starts at step 1 and moves on by itself. Opening a later step by hand
    // could skip Mike's approval or stamp a review done.
    if (body.template_key === 'charter.price_review' && (body.step ?? 1) !== 1) {
      throw new ApiError('A price review can only be opened at step 1. The later steps open themselves.', 400);
    }

    let data;
    try {
      data = buildWaitData({
        ...body,
        due_at: body.due_at ? new Date(body.due_at) : undefined,
        client_waiting_since: body.client_waiting_since ? new Date(body.client_waiting_since) : body.client_waiting_since === null ? null : undefined,
        created_by_id: auth.userId,
        created_by_automation: body.created_by_automation ?? null,
      });
    } catch (e) {
      if (e instanceof TemplateError) throw new ApiError(e.message, e.code === 'template_disabled' ? 409 : 400, e.code);
      throw e;
    }

    const store = prismaSweepStore(prisma);
    const { wait, created } = await store.insertIdempotent(data);
    if (created) {
      await store.addEvent({
        wait_id: wait.id,
        kind: 'created',
        to_state: 'waiting',
        to_due_at: wait.due_at,
        reason: `Opened from ${wait.template_key}.`,
        source: 'api',
        actor_user_id: auth.userId,
      });
    }
    const resolved = await resolveWaitOwner(wait, prismaOwnerLookups(prisma as unknown as Parameters<typeof prismaOwnerLookups>[0]));
    return NextResponse.json(serializeWait(wait, resolved), { status: created ? 201 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
