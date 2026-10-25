import type { EngagementBrief, EngagementPass } from '@prisma/client';

export function serializeBrief(b: EngagementBrief) {
  return {
    id: b.id,
    client_id: b.client_id,
    project_id: b.project_id,
    charter_id: b.charter_id,
    label: b.label,
    goal: b.goal,
    sources: b.sources,
    scope: b.scope,
    allowed_actions: b.allowed_actions,
    release_owner_role: b.release_owner_role,
    stall_rules: b.stall_rules,
    owner_mode: b.owner_mode,
    cadence: b.cadence,
    version: b.version,
    last_pass_at: b.last_pass_at?.toISOString() ?? null,
    created_by_id: b.created_by_id,
    created_at: b.created_at.toISOString(),
    updated_at: b.updated_at.toISOString(),
  };
}

export function serializePass(p: EngagementPass) {
  return {
    id: p.id,
    brief_id: p.brief_id,
    mode: p.mode,
    started_at: p.started_at.toISOString(),
    finished_at: p.finished_at?.toISOString() ?? null,
    model: p.model,
    cost_usd: p.cost_usd == null ? null : Number(p.cost_usd),
    tasks_read: p.tasks_read,
    actions: p.actions,
    mike_items: p.mike_items,
    error: p.error,
  };
}
