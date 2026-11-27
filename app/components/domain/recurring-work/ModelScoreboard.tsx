'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils/cn';
import { useModelLedger } from '@/lib/hooks/use-model-ledger';
import type { LedgerLine, LedgerSummary } from '@/lib/model-ledger/types';

const WINDOWS = [7, 30] as const;

/** Plain words for the machine's task types; anything else shows as written. */
const TYPE_WORDS: Record<string, string> = {
  'citadel-code': 'Citadel code',
  'machine-tools': 'Machine tools',
  'site-repo': 'Site repo',
  'client-site': 'Client site',
  'records-and-reports': 'Records and reports',
  'watch-fix': 'Stopped job fixes',
  intake: 'Intake',
  design: 'Design cards',
  'worker-idle': 'Worker, nothing to do',
  'citadel-dox': 'Dox',
  chat: 'Chat',
  interactive: 'Sessions with Mike',
  'second-check': 'Second check',
  unclassified: 'Other runs',
};

export function typeWords(t: string): string {
  if (TYPE_WORDS[t]) return TYPE_WORDS[t];
  if (t.startsWith('design:')) return `Design: ${t.slice(7).replace(/_/g, ' ')}`;
  if (t.startsWith('dox-')) return `Dox: ${t.slice(4).replace(/[-_]/g, ' ')}`;
  return t.replace(/[-_]/g, ' ');
}

const money = (n: number | null) => (n === null ? '–' : `$${n.toFixed(2)}`);
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);

export function summaryLine(s: LedgerSummary): string {
  const cards = s.lines.reduce((n, l) => n + l.cards, 0);
  return `${s.total_runs} Claude runs · ${cards} cards · ${money(s.total_cost_usd)} at API prices`;
}

function LineRow({ l }: { l: LedgerLine }) {
  const hasCards = l.cards > 0;
  return (
    <tr className="border-t border-border" data-testid="ledger-line">
      <td className="px-3 py-2 font-medium capitalize text-text-main">{l.model}</td>
      <td className="px-3 py-2 text-text-main">{typeWords(l.task_type)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{hasCards ? l.cards : '–'}</td>
      <td className="px-3 py-2 text-right tabular-nums">{hasCards ? pct(l.first_try_rate) : '–'}</td>
      <td className="px-3 py-2 text-right tabular-nums">{hasCards ? money(l.cost_per_finished_card) : '–'}</td>
      <td className={cn('px-3 py-2 text-right tabular-nums', l.escalations > 0 && 'text-text-main font-medium')}>{hasCards ? l.escalations : '–'}</td>
      <td className="px-3 py-2 text-right tabular-nums text-text-sub">{l.runs}</td>
      <td className="px-3 py-2 text-right tabular-nums text-text-sub">{money(l.cost_usd)}</td>
    </tr>
  );
}

export function ModelScoreboardView({ data, days, onDays }: { data: LedgerSummary; days: number; onDays: (d: number) => void }) {
  return (
    <section className="space-y-2" data-testid="model-scoreboard">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-text-main">How each model is doing</h3>
          <p className="text-sm text-text-sub" data-testid="ledger-summary">
            {summaryLine(data)}
          </p>
        </div>
        <div className="flex gap-1" role="group" aria-label="Days shown">
          {WINDOWS.map((w) => (
            <Button key={w} size="sm" variant={w === days ? 'secondary' : 'ghost'} aria-pressed={w === days} onClick={() => onDays(w)}>
              {w} days
            </Button>
          ))}
        </div>
      </div>
      {data.lines.length === 0 ? (
        <p className="text-sm text-text-muted" data-testid="ledger-empty">
          No model numbers for these days yet. The machine sends them each morning.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-warm bg-surface shadow-soft">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Task type</th>
                <th className="px-3 py-2 text-right font-medium">Cards</th>
                <th className="px-3 py-2 text-right font-medium">First try</th>
                <th className="px-3 py-2 text-right font-medium">Per finished card</th>
                <th className="px-3 py-2 text-right font-medium">Escalated</th>
                <th className="px-3 py-2 text-right font-medium">Runs</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <LineRow key={`${l.model}|${l.task_type}`} l={l} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-text-muted">
        First try: the card finished on its first pass and passed the second check in round one. Costs are estimates at API list prices.
      </p>
    </section>
  );
}

export function ModelScoreboard() {
  const [days, setDays] = React.useState<number>(7);
  const { data, isLoading, error } = useModelLedger(days);
  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }
  if (error || !data) {
    return <p className="text-sm text-text-muted">The model numbers did not load. Reload the page to try again.</p>;
  }
  return <ModelScoreboardView data={data} days={days} onDays={setDays} />;
}
