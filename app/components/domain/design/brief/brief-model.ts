import type { BriefResponse, BriefViewBody, ClientStatementView } from '@/lib/hooks/use-design-brief';
import { BRIEF_SECTION_IDS } from '@/lib/design/brief-schema';

export type BriefCardData = BriefViewBody['sections'][number]['cards'][number];
export type BriefSourceData = BriefCardData['sources'][number];

export const CONFIDENCE_LABELS: Record<string, string> = {
  confirmed: 'Confirmed by the client',
  evidenced: 'Backed by evidence',
  inferred: 'Our best guess',
};
export const confidenceLabel = (c: string) => CONFIDENCE_LABELS[c] ?? 'Not rated';

export const PARAPHRASE_LABEL = "Mike's notes of the call";

/** Sections in the spec's fixed order, whatever order the brief arrived in. */
export function orderedSections(body: BriefViewBody): BriefViewBody['sections'] {
  const rank = (id: string) => {
    const i = (BRIEF_SECTION_IDS as readonly string[]).indexOf(id);
    return i === -1 ? BRIEF_SECTION_IDS.length : i;
  };
  return [...body.sections].sort((a, b) => rank(a.id) - rank(b.id));
}

export function statementsById(list: ClientStatementView[]): Map<string, ClientStatementView> {
  return new Map(list.map((s) => [s.id, s]));
}

/** The client statements a card cites, in the card's order; a note that is gone is skipped. */
export function cardStatements(card: BriefCardData, byId: Map<string, ClientStatementView>): ClientStatementView[] {
  const out: ClientStatementView[] = [];
  for (const s of card.sources) {
    if (s.kind !== 'design_note') continue;
    const st = byId.get(s.id);
    if (st) out.push(st);
  }
  return out;
}

/** Only assets the server says a browser can show; the URL is always the session-scoped route, built here. */
export function assetSrc(sessionId: string, assetId: string, data: BriefResponse): string | null {
  const a = data.assets.find((x) => x.id === assetId);
  if (!a || !a.url) return null;
  return `/api/design/sessions/${encodeURIComponent(sessionId)}/track-assets/${encodeURIComponent(assetId)}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
