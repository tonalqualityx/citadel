/**
 * Scope values an API key may carry, and the rules for combining them (fleet item 6).
 *   engine              lets the key use /api/engine/* (requireEngine)
 *   lane:<name>         limits the key to one lane's routes (lib/auth/lane-scopes.ts)
 *   scope-mode:enforce  a lane key outside its lane gets 403 instead of a shadow violation row
 *   decisions:admin     item 2a: lets the key use the decisions admin routes
 */
import { z } from 'zod';
import { ENFORCE_SCOPE, LANE_SCOPE_PREFIX, isLane } from './lane-scopes';

/** Same value as ENGINE_SCOPE in lib/engine/auth.ts (kept here so this module stays free of prisma). */
export const ENGINE_SCOPE = 'engine';

/** Item 2a (fleet/2-decisions) checks this scope on its decisions admin routes. */
export const DECISIONS_ADMIN_SCOPE = 'decisions:admin';

export function isKnownScope(s: string): boolean {
  if (s === ENGINE_SCOPE || s === ENFORCE_SCOPE || s === DECISIONS_ADMIN_SCOPE) return true;
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
    if (scopes.includes(ENFORCE_SCOPE) && lanes.length === 0) {
      ctx.addIssue({ code: 'custom', message: `${ENFORCE_SCOPE} needs a lane scope` });
    }
    if (scopes.includes(ENGINE_SCOPE) && lanes.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'An engine key cannot also be a lane key' });
    }
  });
