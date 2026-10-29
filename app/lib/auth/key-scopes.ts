/**
 * Scope values an API key may carry, and the rules for combining them (fleet item 6).
 *   engine              lets the key use /api/engine/* (requireEngine)
 *   lane:<name>         limits the key to one lane's routes (lib/auth/lane-scopes.ts)
 *   scope-mode:enforce  a lane key outside its lane gets 403 instead of a shadow violation row
 *   decisions:admin     item 2a: lets the key use the decisions admin routes. Only on a key with NO lane (the
 *                       plain admin key), and only for a user with the admin role (checked at mint and PATCH;
 *                       requireDecisionAdmin checks both again on every call)
 *   design:operator-setup    Designer Portal (Mike, 2026-10-29): lets the key use the design ADMIN configuration
 *                            routes (settings, sites, Drive folders, budgets, the overview lists). Nothing else.
 *   design:operator-publish  lets the key act as an ADMIN publisher on publish intent, confirm, rollback and the
 *                            session/publish reads (exactly the admin server path; lib/design/operator.ts).
 * decisions:admin and both design:operator-* scopes are HUMAN-GRANTED (HUMAN_GRANTED_SCOPES): only a signed-in
 * admin session may put them on a key (an API key never can, including one that already holds them), only on a
 * key whose user is an admin, and never on a lane key. The routes check all three again on every call.
 * A lane in ALWAYS_ENFORCED_LANES (design-worker) must carry scope-mode:enforce: a shadow key for it is 400
 * at mint and at PATCH (W8.2 H3).
 */
import { z } from 'zod';
import { ALWAYS_ENFORCED_LANES, ENFORCE_SCOPE, LANE_SCOPE_PREFIX, isLane } from './lane-scopes';

/** Same value as ENGINE_SCOPE in lib/engine/auth.ts (kept here so this module stays free of prisma). */
export const ENGINE_SCOPE = 'engine';

/** Item 2a (fleet/2-decisions) checks this scope on its decisions admin routes. */
export const DECISIONS_ADMIN_SCOPE = 'decisions:admin';

/** Designer Portal operator scopes (Mike, 2026-10-29); the route allowlist is DESIGN_OPERATOR_ROUTES in lib/design/operator.ts. */
export const DESIGN_OPERATOR_SETUP_SCOPE = 'design:operator-setup';
export const DESIGN_OPERATOR_PUBLISH_SCOPE = 'design:operator-publish';

/**
 * Scopes only a signed-in human admin may grant, only on a key whose user is an admin, never on a lane key.
 * POST /api/api-keys and PATCH /api/api-keys/:id enforce the first two; keyScopesSchema the third.
 */
export const HUMAN_GRANTED_SCOPES = [DECISIONS_ADMIN_SCOPE, DESIGN_OPERATOR_SETUP_SCOPE, DESIGN_OPERATOR_PUBLISH_SCOPE] as const;

export function humanGrantedScopesIn(scopes: readonly string[] | null | undefined): string[] {
  return (scopes ?? []).filter((s) => (HUMAN_GRANTED_SCOPES as readonly string[]).includes(s));
}

export function isKnownScope(s: string): boolean {
  if (s === ENGINE_SCOPE || s === ENFORCE_SCOPE || (HUMAN_GRANTED_SCOPES as readonly string[]).includes(s)) return true;
  return s.startsWith(LANE_SCOPE_PREFIX) && isLane(s.slice(LANE_SCOPE_PREFIX.length));
}

export const keyScopesSchema = z
  .array(z.string().refine(isKnownScope, { message: 'Unknown scope' }))
  .max(4)
  .superRefine((scopes, ctx) => {
    if (new Set(scopes).size !== scopes.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate scope' });
    }
    const lanes = scopes.filter((s) => s.startsWith(LANE_SCOPE_PREFIX));
    if (lanes.length > 1) ctx.addIssue({ code: 'custom', message: 'A key carries at most one lane' });
    for (const l of lanes) {
      const lane = l.slice(LANE_SCOPE_PREFIX.length);
      if ((ALWAYS_ENFORCED_LANES as readonly string[]).includes(lane) && !scopes.includes(ENFORCE_SCOPE)) {
        ctx.addIssue({ code: 'custom', message: `${l} keys must carry ${ENFORCE_SCOPE}` });
      }
    }
    if (scopes.includes(ENFORCE_SCOPE) && lanes.length === 0) {
      ctx.addIssue({ code: 'custom', message: `${ENFORCE_SCOPE} needs a lane scope` });
    }
    for (const granted of humanGrantedScopesIn(scopes)) {
      if (lanes.length > 0) ctx.addIssue({ code: 'custom', message: `${granted} cannot be granted on a lane key` });
    }
    if (scopes.includes(ENGINE_SCOPE) && lanes.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'An engine key cannot also be a lane key' });
    }
  });
