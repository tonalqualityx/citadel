'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { MarkdownSubset, safeHttpsUrl } from '@/lib/design/markdown-subset';
import type { BriefResponse, ClientStatementView } from '@/lib/hooks/use-design-brief';
import { ClientQuote } from './ClientQuote';
import { assetSrc, confidenceLabel, formatDate, type BriefCardData, type BriefSourceData } from './brief-model';

export interface BriefDrawerProps {
  sessionId: string;
  card: BriefCardData | null;
  data: BriefResponse;
  statementsById: Map<string, ClientStatementView>;
  onClose: () => void;
  /** Where focus goes when the drawer closes (the card's button that opened it). */
  returnFocusRef: React.RefObject<HTMLElement | null>;
}

function SourceItem({ source, byId }: { source: BriefSourceData; byId: Map<string, ClientStatementView> }) {
  if (source.kind === 'design_note') {
    const st = byId.get(source.id);
    return st ? <ClientQuote statement={st} /> : <span className="text-sm text-text-sub">A note from the client that is no longer shown.</span>;
  }
  if (source.kind === 'url') {
    const href = safeHttpsUrl(source.url);
    const when = formatDate(source.accessed);
    return (
      <span className="text-sm text-text-main">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-2">{source.url}</a>
        ) : (
          <span className="break-all">{source.url}</span>
        )}
        {when && <span className="text-text-sub">{` (looked at ${when})`}</span>}
      </span>
    );
  }
  if (source.kind === 'file') return <span className="break-all text-sm text-text-main">{`File: ${source.path}`}</span>;
  return <span className="text-sm text-text-main">{`Drive: ${source.title || 'Untitled file'}`}</span>;
}

/** A side panel with dialog semantics: focus is trapped, Escape closes, focus returns to the card's button. */
export function BriefDrawer({ sessionId, card, data, statementsById, onClose, returnFocusRef }: BriefDrawerProps) {
  const open = card !== null;
  const images = card ? card.image_asset_ids.map((id) => assetSrc(sessionId, id, data)).filter((s): s is string => !!s) : [];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocusRef.current?.focus();
          }}
          className="fixed right-0 top-0 z-50 flex h-full w-[min(100vw,560px)] flex-col border-l border-border bg-surface shadow-2xl focus:outline-none"
        >
          {card && (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-border-warm p-4">
                <div className="min-w-0">
                  <DialogPrimitive.Title className="text-lg font-semibold text-text-main">{card.headline}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 text-xs text-text-sub">{confidenceLabel(card.confidence)}</DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md hover:bg-background-light focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-0 sm:min-w-0 sm:p-1">
                  <X className="h-5 w-5" aria-hidden="true" />
                  <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
              </div>
              <div className="flex-1 overflow-y-auto p-4" data-testid="brief-drawer-body">
                {images.length > 0 && (
                  <div className="mb-3 flex flex-col gap-2">
                    {images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={src} src={src} alt={`Picture ${i + 1} of ${images.length} for the finding "${card.headline}"`} className="block w-full rounded-md border border-border-warm" />
                    ))}
                  </div>
                )}
                <p className="text-sm text-text-main">{card.summary}</p>
                {card.detail_md.trim() ? (
                  <MarkdownSubset source={card.detail_md} className="mt-2 text-sm leading-relaxed text-text-main" />
                ) : (
                  <p className="mt-2 text-sm text-text-sub">There is no more detail for this one.</p>
                )}
                <h3 className="mt-5 text-sm font-semibold text-text-main">Where this came from</h3>
                {card.sources.length === 0 ? (
                  <p className="mt-1 text-sm text-text-sub">No sources are listed.</p>
                ) : (
                  <ul className="mt-2 space-y-2" aria-label="Sources">
                    {card.sources.map((s, i) => (
                      <li key={i}><SourceItem source={s} byId={statementsById} /></li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
