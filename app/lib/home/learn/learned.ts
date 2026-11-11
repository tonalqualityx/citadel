/**
 * Slice 7b: the settings list. One sentence per weight not at 100. Never a weight, a percent or a count.
 */

import type { HomeDb } from '../state';
import { learnedSettingsSentence } from './copy';
import { WEIGHT } from './weights';

export interface LearnedItem {
  evidence_key: string;
  sentence: string;
  since: string | null;
}

function dayText(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: tz }).format(at);
}

export async function listLearned(db: HomeDb, userId: string, tz: string): Promise<LearnedItem[]> {
  const rows = await db.homeScoreWeight.findMany({
    where: { user_id: userId, weight_pct: { not: WEIGHT.start } },
    select: { evidence_key: true, label: true, weight_pct: true, changed_at: true },
    orderBy: [{ changed_at: 'asc' }, { evidence_key: 'asc' }],
  });
  return rows.map((r) => ({
    evidence_key: r.evidence_key,
    sentence: learnedSettingsSentence(r.evidence_key, r.label, r.weight_pct, r.changed_at ? dayText(r.changed_at, tz) : null),
    since: r.changed_at ? r.changed_at.toISOString() : null,
  }));
}
