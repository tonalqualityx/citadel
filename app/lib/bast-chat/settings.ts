/**
 * Bast chat: the settings singleton (BastChatSettings id 1). Owner, kill switch, model, caps.
 *
 * `getSettings` always answers (defaults when the row does not exist yet: disabled, no owner), as plain numbers.
 * `updateSettings` is for the owner's admin route: strict partial body, the model limited to sonnet or haiku
 * (the machine checks again), the new owner must be an active admin.
 */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultDb } from '@/lib/db/prisma';
import { ApiError } from '@/lib/api/errors';

/** Never opus, fable, best or default. Same pattern as the daemon's allowlist. */
export const ALLOWED_MODEL_RE = /^(sonnet|haiku|claude-(sonnet|haiku)-\d+(-\d+)*(-\d{8})?)$/;
export const EFFORTS = ['low', 'medium', 'high'] as const;
/** Tool round trips per turn, served to the daemon. */
export const MAX_TURNS_PER_ANSWER = 10;

export interface ChatSettings {
  enabled: boolean;
  owner_user_id: string | null;
  model: string;
  effort: string;
  turn_budget_usd: number;
  daily_turn_cap: number;
  daily_write_cap: number;
  daily_cost_cap_usd: number;
  stale_after_minutes: number;
  idle_close_minutes: number;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  enabled: false,
  owner_user_id: null,
  model: 'sonnet',
  effort: 'low',
  turn_budget_usd: 0.4,
  daily_turn_cap: 100,
  daily_write_cap: 25,
  daily_cost_cap_usd: 8,
  stale_after_minutes: 120,
  idle_close_minutes: 10,
};

const n = (d: { toString(): string } | number | null | undefined, fallback: number): number => {
  if (d === null || d === undefined) return fallback;
  const v = Number(d.toString());
  return Number.isFinite(v) ? v : fallback;
};

export async function getSettings(db: Pick<PrismaClient, 'bastChatSettings'> = defaultDb): Promise<ChatSettings> {
  const r = await db.bastChatSettings.findUnique({ where: { id: 1 } });
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    enabled: r.enabled === true,
    owner_user_id: r.owner_user_id ?? null,
    model: r.model,
    effort: r.effort,
    turn_budget_usd: n(r.turn_budget_usd, DEFAULT_SETTINGS.turn_budget_usd),
    daily_turn_cap: r.daily_turn_cap,
    daily_write_cap: r.daily_write_cap,
    daily_cost_cap_usd: n(r.daily_cost_cap_usd, DEFAULT_SETTINGS.daily_cost_cap_usd),
    stale_after_minutes: r.stale_after_minutes,
    idle_close_minutes: r.idle_close_minutes,
  };
}

export const settingsPatchSchema = z
  .object({
    enabled: z.boolean(),
    owner_user_id: z.string().uuid(),
    model: z.string().regex(ALLOWED_MODEL_RE, 'Only Sonnet or Haiku can answer in the chat'),
    effort: z.enum(EFFORTS),
    turn_budget_usd: z.number().min(0.05).max(5),
    daily_turn_cap: z.number().int().min(1).max(1000),
    daily_write_cap: z.number().int().min(0).max(500),
    daily_cost_cap_usd: z.number().min(0.5).max(100),
    stale_after_minutes: z.number().int().min(5).max(1440),
    idle_close_minutes: z.number().int().min(1).max(120),
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Validate and save. Throws ZodError (400) on a bad or unknown field, ApiError 400 when the owner is not an active admin. */
export async function updateSettings(
  raw: unknown,
  actorId: string,
  db: Pick<PrismaClient, 'bastChatSettings' | 'user'> = defaultDb,
): Promise<ChatSettings> {
  const patch = settingsPatchSchema.parse(raw);
  if (patch.owner_user_id) {
    const u = await db.user.findUnique({ where: { id: patch.owner_user_id }, select: { role: true, is_active: true } });
    if (!u || !u.is_active || u.role !== 'admin') throw new ApiError('The chat owner must be an active admin', 400, 'bad_owner');
  }
  const data = { ...patch, updated_by_id: actorId };
  await db.bastChatSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  return getSettings(db);
}
