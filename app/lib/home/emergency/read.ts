/**
 * Home screen Slice 6a: the read side of the "Not an emergency" rules, kept apart from store.ts so the loader can use it
 * without importing the keeper (store.ts re-exports it).
 */

import { parseRuleKey, RULE_KEY_PREFIX, RULE_LANE, type NotEmergencyRule } from './rule';
import type { HomeDb } from '../state';

/** The caller's confirmed "Not an emergency" rules (lane home-emergency, their own, key ours). */
export async function loadNotEmergencyRules(db: HomeDb, userId: string): Promise<NotEmergencyRule[]> {
  const rows = await db.decision.findMany({
    where: { lane: RULE_LANE, status: 'confirmed', created_by_id: userId, key: { startsWith: RULE_KEY_PREFIX } },
    select: { key: true },
    orderBy: { created_at: 'asc' },
    take: 500,
  });
  const out: NotEmergencyRule[] = [];
  for (const r of rows) {
    const p = parseRuleKey(r.key);
    if (p) out.push(p);
  }
  return out;
}
