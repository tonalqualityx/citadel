/**
 * Why Dox is asking about a dated Triage card, in plain words (Dox slice 2c). Dox's question about a dated project card carries a cause_key that
 * starts `triage-date:` (`triage-date:start:<card id>` or `triage-date:launch:<card id>`); the card shows the reason from the key and the project's dates.
 * Pure.
 */
import { shortDay } from './plan-summary';

export const TRIAGE_DATE_PREFIX = 'triage-date:';

export interface TriageDateFlag {
  kind: 'start' | 'launch';
  reason: string;
}

export function triageDateFlags(causeKeys: readonly (string | null)[], start: string | null, launch: string | null): TriageDateFlag[] {
  const kinds = new Set<'start' | 'launch'>();
  for (const k of causeKeys) {
    if (!k || !k.startsWith(TRIAGE_DATE_PREFIX)) continue;
    const kind = k.slice(TRIAGE_DATE_PREFIX.length).split(':')[0];
    if (kind === 'start' || kind === 'launch') kinds.add(kind);
  }
  const out: TriageDateFlag[] = [];
  if (kinds.has('start')) out.push({ kind: 'start', reason: start ? `Start date was ${shortDay(start)}, and this card is still waiting for you.` : 'The start date has passed, and this card is still waiting for you.' });
  if (kinds.has('launch')) out.push({ kind: 'launch', reason: launch ? `Launch is ${shortDay(launch)}, close enough that the site needs setting up now, and this card is still waiting for you.` : 'Launch is close enough that the site needs setting up now, and this card is still waiting for you.' });
  return out;
}
