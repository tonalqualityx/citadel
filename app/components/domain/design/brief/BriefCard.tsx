'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useBriefReaction, type BriefReactionKind, type BriefReactionView, type BriefResponse, type ClientStatementView } from '@/lib/hooks/use-design-brief';
import { ClientQuote } from './ClientQuote';
import { assetSrc, confidenceLabel, type BriefCardData } from './brief-model';

export interface BriefCardProps {
  sessionId: string;
  card: BriefCardData;
  data: BriefResponse;
  statements: ClientStatementView[];
  reaction: BriefReactionView | undefined;
  onOpen: (card: BriefCardData, opener: HTMLElement) => void;
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';

export function BriefCard({ sessionId, card, data, statements, reaction, onOpen }: BriefCardProps) {
  const mutation = useBriefReaction(sessionId);
  const current = reaction?.reaction as BriefReactionKind | undefined;
  const [note, setNote] = React.useState(reaction?.note ?? '');
  const noteId = React.useId();
  const firstImage = card.image_asset_ids.map((id) => assetSrc(sessionId, id, data)).find((s): s is string => !!s) ?? null;

  const save = (kind: BriefReactionKind, text: string) => {
    const trimmed = text.trim();
    mutation.mutate({ card_id: card.id, reaction: kind, ...(trimmed ? { note: trimmed } : {}) });
  };
  const toggle = (kind: BriefReactionKind) => {
    if (current === kind) return; // there is no way to clear a mark, so the pressed button stays pressed
    save(kind, note);
  };

  const pill = (kind: BriefReactionKind, label: string) => (
    <button
      type="button"
      aria-pressed={current === kind}
      onClick={() => toggle(kind)}
      className={`min-h-[44px] rounded-md border px-3 text-sm sm:min-h-0 sm:py-1 ${FOCUS} ${
        current === kind ? 'border-primary bg-primary/10 font-semibold text-text-main' : 'border-border-warm bg-surface text-text-main hover:bg-background-light'
      }`}
    >
      {current === kind ? `✓ ${label}` : label}
    </button>
  );

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-border-warm bg-surface p-3" data-testid="brief-card">
      {firstImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={firstImage}
          alt={`Picture for the finding "${card.headline}"`}
          loading="lazy"
          className="block max-h-48 w-full rounded-md border border-border-warm object-cover"
        />
      )}
      <h4 className="text-sm font-semibold text-text-main">{card.headline}</h4>
      <p className="text-xs text-text-sub" data-testid="confidence">{confidenceLabel(card.confidence)}</p>
      {statements.slice(0, 2).map((s) => <ClientQuote key={s.id} statement={s} />)}
      <p className="text-sm text-text-main">{card.summary}</p>
      <div>
        <Button type="button" variant="secondary" size="sm" className="min-h-[44px] sm:min-h-0" aria-label={`Open details and sources: ${card.headline}`}
          onClick={(e) => onOpen(card, e.currentTarget)}>
          Details and sources
        </Button>
      </div>
      <div role="group" aria-label={`Your view of: ${card.headline}`} className="mt-1 flex flex-col gap-2 border-t border-border-warm pt-2">
        <div className="flex flex-wrap gap-2">
          {pill('useful', 'Useful')}
          {pill('not_relevant', 'Not relevant')}
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (current) save(current, note); }}
        >
          <label htmlFor={noteId} className="sr-only">{`Note on: ${card.headline}`}</label>
          <input
            id={noteId}
            type="text"
            value={note}
            maxLength={200}
            disabled={!current}
            onChange={(e) => setNote(e.target.value)}
            placeholder={current ? 'One line note (optional)' : 'Mark it first to add a note'}
            className={`min-h-[44px] min-w-0 flex-1 rounded-md border border-border-warm bg-surface px-2 text-sm text-text-main disabled:opacity-60 sm:min-h-0 sm:py-1 ${FOCUS}`}
          />
          <Button type="submit" variant="ghost" size="sm" className="min-h-[44px] sm:min-h-0" disabled={!current || mutation.isPending}>
            Save note
          </Button>
        </form>
        <p role="alert" className="text-xs text-red-700" data-testid="reaction-error">
          {mutation.isError ? 'That did not save. Please try again.' : ''}
        </p>
      </div>
    </li>
  );
}
