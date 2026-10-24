import { z } from 'zod';

/** Roles a stand-in can cover. `client` and `switch_owner` are never a person's role. */
export const STAND_IN_ROLES = ['mike', 'pm', 'design', 'content', 'liaison', 'wordpress', 'billing', 'social', 'sales', 'bast'] as const;

const iso = z.string().datetime({ offset: true });

export const awayWindowCreateSchema = z.object({
  user_id: z.string().uuid(),
  starts_at: iso,
  ends_at: iso,
  source: z.enum(['manual', 'calendar']).default('manual'),
  confirmed_at: iso.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const awayWindowPatchSchema = z.object({
  starts_at: iso.optional(),
  ends_at: iso.optional(),
  confirmed_at: iso.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export const standInCreateSchema = z.object({
  for_user_id: z.string().uuid(),
  role_key: z.enum(STAND_IN_ROLES),
  stand_in_user_id: z.string().uuid(),
});

export const standInPatchSchema = z.object({
  stand_in_user_id: z.string().uuid(),
});

export function serializeAwayWindow(w: {
  id: string;
  user_id: string;
  starts_at: Date;
  ends_at: Date;
  source: string;
  confirmed_at: Date | null;
  note: string | null;
  created_at: Date;
}) {
  return {
    id: w.id,
    user_id: w.user_id,
    starts_at: w.starts_at.toISOString(),
    ends_at: w.ends_at.toISOString(),
    source: w.source,
    confirmed_at: w.confirmed_at ? w.confirmed_at.toISOString() : null,
    note: w.note,
    created_at: w.created_at.toISOString(),
  };
}

export function serializeStandIn(s: { id: string; for_user_id: string; role_key: string; stand_in_user_id: string }) {
  return { id: s.id, for_user_id: s.for_user_id, role_key: s.role_key, stand_in_user_id: s.stand_in_user_id };
}
