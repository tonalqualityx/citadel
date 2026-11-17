'use client';

import * as React from 'react';
import { Check, ExternalLink, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal, ModalContent, ModalDescription, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { cn } from '@/lib/utils/cn';
import { rejectSentence, useDecideReference, type BoardAsset, type BoardReference, type CaptureStatus } from '@/lib/hooks/use-design-board';
import { MarkupImage } from './MarkupImage';

const SOURCE_WORDS: Record<string, string> = {
  bast_pick: 'Picked by Bast',
  client_named: 'Named by the client',
  designer_url: 'Added by you',
  designer_upload: 'Uploaded by you',
  designer_figma: 'From your Figma file',
  indelible_site: 'One of our own sites',
};

export const sourceWords = (source: string) => SOURCE_WORDS[source] ?? 'Added to the board';

const STATUS_WORDS: Record<CaptureStatus, string> = {
  none: 'Not captured',
  queued: 'Capturing',
  captured: 'Captured',
  failed: 'Could not capture',
  blocked: 'Blocked',
};

/** Capture error text from the box is shown when it reads as a sentence; a bare code gets a plain sentence instead. */
export function captureSentence(status: CaptureStatus, error: string | null, figma = false): string | null {
  const stored = error && /\s/.test(error) ? error : null;
  if (status === 'failed') return stored ?? (figma ? 'We could not bring in this Figma design. Check that the file is shared with Indelible\'s Figma account, then paste the link again.' : 'We could not take pictures of this site. You can try adding it again.');
  if (status === 'blocked') return stored ?? (figma ? 'We are not allowed to open this Figma file. Share it with Indelible\'s Figma account, then paste the link again.' : 'This site does not allow us to take pictures of it.');
  return null;
}

const FIGMA_STATUS_WORDS: Record<CaptureStatus, string> = { ...STATUS_WORDS, none: 'Not brought in', queued: 'Bringing it in', captured: 'Ready', failed: 'Could not bring in', blocked: 'Blocked' };

/** The small line of what was read from a Figma frame: its name, its size, and a note when only some frames came in. */
export function figmaLines(f: NonNullable<BoardReference['figma']>): { read: string | null; partial: string | null } {
  const parts: string[] = [];
  if (f.frame_name) parts.push(f.frame_name);
  if (f.width && f.height) parts.push(`${f.width} x ${f.height}`);
  const partial = f.frames_total != null && f.frames_imported != null && f.frames_total > f.frames_imported
    ? `Showing the first ${f.frames_imported} of ${f.frames_total} frames. Paste a link to a single frame to add another.`
    : null;
  return { read: parts.length > 0 ? parts.join(' - ') : null, partial };
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function safeHttpsUrl(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; }
}

function UploadItem({ sessionId, reference, upload, index }: { sessionId: string; reference: BoardReference; upload: BoardReference['uploads'][number]; index: number }) {
  const { asset, renders } = upload;
  if (asset.status === 'rejected') {
    return <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{rejectSentence(asset.reject_reason)}</p>;
  }
  if (asset.status === 'pending') {
    return <p className="flex items-center gap-2 text-sm text-text-sub"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Getting this file ready.</p>;
  }
  const first: BoardAsset | undefined = asset.url ? asset : renders[0];
  const rest = asset.url ? [] : renders.slice(1);
  return (
    <div className="space-y-2">
      {first ? <MarkupImage sessionId={sessionId} referenceId={reference.id} asset={first} label={renders.length > 1 ? 'Page 1' : `Upload ${index + 1}`} title={reference.title} markups={reference.markups} /> : <p className="text-sm text-text-sub">No picture to show for this file.</p>}
      {rest.length > 0 && <MorePages sessionId={sessionId} reference={reference} assets={rest} labels={rest.map((a, i) => `Page ${(a.page ?? i + 1) + (a.page ? 0 : 1)}`)} buttonText={`See all ${renders.length} pages`} />}
    </div>
  );
}

function MorePages({ sessionId, reference, assets, labels, buttonText }: { sessionId: string; reference: BoardReference; assets: BoardAsset[]; labels: string[]; buttonText: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" className="min-h-[44px] sm:min-h-8" onClick={() => setOpen(true)}>{buttonText}</Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent size="xl" className="max-w-[min(64rem,calc(100vw-2rem))]">
          <ModalHeader>
            <ModalTitle>{reference.title}</ModalTitle>
            <ModalDescription>Full pages. Drag on a picture to mark a part of it.</ModalDescription>
          </ModalHeader>
          <div className="grid gap-4 p-6 sm:grid-cols-2">
            {assets.map((a, i) => <MarkupImage key={a.id} sessionId={sessionId} referenceId={reference.id} asset={a} label={labels[i]} title={reference.title} markups={reference.markups} />)}
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}

export interface ReferenceCardProps {
  sessionId: string;
  reference: BoardReference;
}

export function ReferenceCard({ sessionId, reference: r }: ReferenceCardProps) {
  const decide = useDecideReference(sessionId);
  const [note, setNote] = React.useState(r.decision_note ?? '');
  const [error, setError] = React.useState('');
  const noteId = React.useId();
  const headingId = React.useId();
  const link = safeHttpsUrl(r.url);
  const isFigma = r.source === 'designer_figma';
  const sentence = captureSentence(r.capture_status, r.capture_error, isFigma);
  const figmaInfo = r.figma ? figmaLines(r.figma) : null;
  const statusWords = isFigma ? FIGMA_STATUS_WORDS : STATUS_WORDS;
  const isUrlCard = r.url !== null;

  const choose = (decision: 'yes' | 'no') => {
    setError('');
    const next = r.decision === decision ? 'pending' : decision;
    const trimmed = note.trim();
    decide.mutate(
      { refId: r.id, decision: next, ...(trimmed !== (r.decision_note ?? '') ? { decision_note: trimmed || null } : {}) },
      { onError: () => setError('That choice did not save. It has been put back, so please try again.') },
    );
  };
  const saveNote = () => {
    const trimmed = note.trim();
    if (trimmed === (r.decision_note ?? '')) return;
    setError('');
    decide.mutate({ refId: r.id, decision_note: trimmed || null }, { onError: () => setError('The reason did not save. Please try again.') });
  };

  const c = r.captures;
  const hasCaptures = !!(c.desktop_fold || c.phone_fold);
  const fullAssets = [c.desktop_full, c.phone_full].filter((a): a is BoardAsset => !!a);
  const fullLabels = [c.desktop_full ? 'Desktop, full page' : null, c.phone_full ? 'Phone, full page' : null].filter((x): x is string => !!x);

  return (
    <li className="rounded-lg border border-border-warm bg-surface p-3 sm:p-4" data-testid="reference-card" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-sm font-semibold text-text-main">{r.title}</h3>
          <p className="text-xs text-text-sub">
            {sourceWords(r.source)}
            {r.url && (link
              ? <> - <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{isFigma ? 'Open in Figma' : hostOf(r.url)}<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a></>
              : <> - {hostOf(r.url)}</>)}
          </p>
        </div>
        {isUrlCard && (
          <Badge variant={r.capture_status === 'captured' ? 'success' : r.capture_status === 'failed' || r.capture_status === 'blocked' ? 'error' : 'default'} data-testid="capture-chip" className="gap-1">
            {r.capture_status === 'queued' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
            {r.capture_status === 'captured' && <Check className="h-3 w-3" aria-hidden="true" />}
            {(r.capture_status === 'failed' || r.capture_status === 'blocked') && <X className="h-3 w-3" aria-hidden="true" />}
            {statusWords[r.capture_status]}
          </Badge>
        )}
      </div>

      {r.why_md && (
        <div className="mt-2 rounded-lg bg-background-light p-2">
          <p className="text-xs font-medium text-text-sub">{r.source === 'client_named' ? 'What the client said' : r.source === 'bast_pick' ? 'Why Bast picked it' : 'Why it is here'}</p>
          <p className="whitespace-pre-line text-sm text-text-main" data-testid="why-text">{r.why_md}</p>
        </div>
      )}
      {sentence && <p className="mt-2 text-sm text-text-main" data-testid="capture-sentence">{sentence}</p>}
      {figmaInfo && (figmaInfo.read || figmaInfo.partial) && (
        <div className="mt-2 text-xs text-text-sub" data-testid="figma-line">
          {figmaInfo.read && <p>{figmaInfo.read}</p>}
          {figmaInfo.partial && <p>{figmaInfo.partial}</p>}
        </div>
      )}

      {hasCaptures && (
        <div className={cn('mt-3 grid gap-3', c.desktop_fold && c.phone_fold ? 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : 'grid-cols-1')}>
          {c.desktop_fold && <MarkupImage sessionId={sessionId} referenceId={r.id} asset={c.desktop_fold} label={isFigma ? 'Frame' : 'Desktop, top of the page'} title={r.title} markups={r.markups} />}
          {c.phone_fold && <MarkupImage sessionId={sessionId} referenceId={r.id} asset={c.phone_fold} label={isFigma ? 'Frame' : 'Phone, top of the page'} title={r.title} markups={r.markups} />}
        </div>
      )}
      {fullAssets.length > 0 && <div className="mt-2"><MorePages sessionId={sessionId} reference={r} assets={fullAssets} labels={fullLabels} buttonText="See the full pages" /></div>}

      {r.uploads.length > 0 && <div className="mt-3 space-y-3">{r.uploads.map((u, i) => <UploadItem key={u.asset.id} sessionId={sessionId} reference={r} upload={u} index={i} />)}</div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={r.decision === 'yes' ? 'primary' : 'secondary'} className="min-h-[44px] sm:min-h-8" aria-pressed={r.decision === 'yes'} onClick={() => choose('yes')}>
          {r.decision === 'yes' && <Check className="h-4 w-4" aria-hidden="true" />}
          Yes<span className="sr-only">, I want this on the board</span>
        </Button>
        <Button type="button" size="sm" variant={r.decision === 'no' ? 'primary' : 'secondary'} className="min-h-[44px] sm:min-h-8" aria-pressed={r.decision === 'no'} onClick={() => choose('no')}>
          {r.decision === 'no' && <X className="h-4 w-4" aria-hidden="true" />}
          No<span className="sr-only">, set this aside</span>
        </Button>
        <div className="min-w-[10rem] flex-1">
          <label htmlFor={noteId} className="sr-only">Reason (optional) for {r.title}</label>
          <input
            id={noteId}
            type="text"
            maxLength={500}
            value={note}
            placeholder="Reason (optional)"
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            className={cn('block min-h-[44px] w-full rounded-lg border border-border-warm bg-surface px-3 py-2 text-sm text-text-main sm:min-h-9', 'focus:outline-none focus:ring-2 focus:ring-primary/40')}
          />
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}
