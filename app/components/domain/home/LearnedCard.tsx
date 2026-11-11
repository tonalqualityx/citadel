'use client';

/**
 * Slice 7b: "What the home screen learned", inside Settings > First screen. One sentence per learned weight with
 * "Put back", and the "Learn from my taps" switch. Sentences only: no number from a weight is ever shown.
 */

import { Button } from '@/components/ui/button';
import { useHomeLearned, useHomeLearnedChange } from '@/lib/hooks/use-home-learned';
import { LEARNED_EMPTY, LEARNED_HEADING, LEARNED_PUT_BACK, LEARNED_SWITCH_HINT, LEARNED_SWITCH_LABEL } from '@/lib/home/learn/copy';

export function LearnedCard() {
  const { data, isLoading, isError } = useHomeLearned();
  const change = useHomeLearnedChange();

  if (isLoading) return null;
  if (isError || !data) return null;

  return (
    <section className="mt-6 border-t border-border-warm pt-4" aria-label={LEARNED_HEADING}>
      <h3 className="font-medium text-text-main">{LEARNED_HEADING}</h3>
      {data.items.length === 0 ? (
        <p className="text-sm text-text-sub mt-1">{LEARNED_EMPTY}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {data.items.map((item) => (
            <li key={item.evidence_key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-text-main">{item.sentence}</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={change.isPending}
                onClick={() => change.mutate({ action: 'put_back', evidence_key: item.evidence_key })}
              >
                {LEARNED_PUT_BACK}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-4 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          role="switch"
          className="mt-1"
          checked={data.on}
          disabled={change.isPending}
          onChange={(e) => change.mutate({ action: 'learning', on: e.target.checked })}
        />
        <span>
          <span className="block text-sm font-medium text-text-main">{LEARNED_SWITCH_LABEL}</span>
          <span className="block text-sm text-text-sub">{LEARNED_SWITCH_HINT}</span>
        </span>
      </label>
    </section>
  );
}
