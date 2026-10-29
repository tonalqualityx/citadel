import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { BUDGET_DEFAULTS } from '@/lib/design/budget';
import { toUsd } from '@/lib/design/helpers';
import { DESIGN_PUBLISH_MODES } from '@/lib/design/publish-policy';
import { SESSION_DEFAULTS } from '@/lib/design/sessions';
import { authActor, body, guardMutation, requireAdmin, requireSessionVia } from '@/lib/design/route-kit';

type SettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.designPortalSettings.findUnique>>>;

/** Decimal columns as numbers; the same shape whether the row exists or not (the row appears on first PATCH). */
export function serializeSettings(row: SettingsRow | null) {
  return {
    enabled: row?.enabled ?? false,
    owner_user_id: row?.owner_user_id ?? null,
    designer_publish_mode: row?.designer_publish_mode ?? 'per_site',
    confirmation_ttl_minutes: row?.confirmation_ttl_minutes ?? 10,
    default_session_budget_usd: row ? toUsd(row.default_session_budget_usd) : SESSION_DEFAULTS.budget_usd,
    designer_raise_cap_usd: row ? toUsd(row.designer_raise_cap_usd) : BUDGET_DEFAULTS.designer_raise_cap_usd,
    hard_session_cap_usd: row ? toUsd(row.hard_session_cap_usd) : BUDGET_DEFAULTS.hard_session_cap_usd,
    default_monthly_cap_usd: row && row.default_monthly_cap_usd !== null ? toUsd(row.default_monthly_cap_usd) : null,
    model: row?.model ?? SESSION_DEFAULTS.model,
    effort: row?.effort ?? SESSION_DEFAULTS.effort,
    idle_close_minutes: row?.idle_close_minutes ?? 10,
    auto_timer_enabled: row?.auto_timer_enabled ?? true,
    auto_timer_lapse_minutes: row?.auto_timer_lapse_minutes ?? 5,
    auto_timer_billable: row?.auto_timer_billable ?? false,
    max_live_sessions: row?.max_live_sessions ?? 4,
    updated_at: row?.updated_at ?? null,
  };
}

// GET /api/design/admin/settings (design 7.2): admin, signed-in session.
export async function GET() {
  try {
    const { actor } = await authActor();
    requireSessionVia(actor);
    requireAdmin(actor);
    const [row, state] = await Promise.all([
      prisma.designPortalSettings.findUnique({ where: { id: 1 } }),
      prisma.designWorkerState.findUnique({ where: { id: 1 } }),
    ]);
    return NextResponse.json({
      settings: serializeSettings(row),
      worker_state: state
        ? {
            last_heartbeat_at: state.last_heartbeat_at, version: state.version, sdk_version: state.sdk_version, paused: state.paused,
            pause_reason: state.pause_reason, configured_site_ids: state.configured_site_ids, site_main_roles: state.site_main_roles ?? {},
            site_live_urls: state.site_live_urls ?? {}, live_sessions: state.live_sessions,
          }
        : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const money = (max: number) => z.number().finite().min(0.01).max(max);
const settingsSchema = z
  .object({
    enabled: z.boolean(),
    owner_user_id: z.string().uuid().nullable(),
    designer_publish_mode: z.enum(DESIGN_PUBLISH_MODES),
    confirmation_ttl_minutes: z.number().int().min(1).max(60),
    default_session_budget_usd: money(1000),
    designer_raise_cap_usd: money(1000),
    hard_session_cap_usd: money(5000),
    default_monthly_cap_usd: money(100000).nullable(),
    model: z.string().trim().min(1).max(60).refine((m) => !/fable/i.test(m), { message: 'The Fable model cannot be used for the designer worker' }),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    idle_close_minutes: z.number().int().min(1).max(240),
    auto_timer_enabled: z.boolean(),
    auto_timer_lapse_minutes: z.number().int().min(1).max(60),
    auto_timer_billable: z.boolean(),
    max_live_sessions: z.number().int().min(1).max(20),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

// PATCH /api/design/admin/settings (design 7.2): any settings field; model refused if /fable/i.
export async function PATCH(request: NextRequest) {
  try {
    const blocked = guardMutation(request);
    if (blocked) return blocked;
    const { actor } = await authActor();
    requireSessionVia(actor);
    requireAdmin(actor);
    const input = await body(request, settingsSchema, 8192);

    const current = serializeSettings(await prisma.designPortalSettings.findUnique({ where: { id: 1 } }));
    const raise = input.designer_raise_cap_usd ?? current.designer_raise_cap_usd;
    const hard = input.hard_session_cap_usd ?? current.hard_session_cap_usd;
    if (raise > hard) throw new ApiError('The designer raise cap cannot exceed the hard session cap', 400, 'bad_caps');
    if (input.owner_user_id) {
      const owner = await prisma.user.findUnique({ where: { id: input.owner_user_id }, select: { id: true, is_active: true } });
      if (!owner || !owner.is_active) throw new ApiError('owner_user_id is not an active user', 400, 'bad_owner');
    }

    const row = await prisma.designPortalSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...input, updated_by_id: actor.userId },
      update: { ...input, updated_by_id: actor.userId },
    });
    return NextResponse.json({ settings: serializeSettings(row) });
  } catch (error) {
    return handleApiError(error);
  }
}
