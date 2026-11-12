'use client';

import * as React from 'react';
import { Link2 } from 'lucide-react';
import { buildPreviewLink, buildSiteLink } from '@/lib/design/preview-link';
import { previewLinkErrorText, useEmailPreviewLink } from '@/lib/hooks/use-design-preview-link';
import { cn } from '@/lib/utils/cn';

export interface PreviewLinksProps {
  sessionId: string;
  /** `session.preview_url`, the track alias. Null until the first preview exists. */
  previewUrl: string | null;
  /** The page the designer is on (from the preview bridge), for example "/about/". Null when unknown. */
  path: string | null;
}

const ROW = 'flex flex-wrap items-center gap-2';
const BTN =
  'inline-flex min-h-[44px] items-center justify-center rounded-md border border-border-warm bg-surface px-3 text-xs font-medium text-text-main hover:bg-background-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 sm:min-h-8';
const LINK = 'inline-flex min-h-[44px] items-center text-sm font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-8';

type CopyKey = 'page' | 'site';

export function PreviewLinks({ sessionId, previewUrl, path }: PreviewLinksProps) {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState<CopyKey | null>(null);
  const [copyNote, setCopyNote] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const email = useEmailPreviewLink(sessionId);

  const siteLink = buildSiteLink(previewUrl);
  const pageLink = path ? buildPreviewLink(previewUrl, path) : null;
  const ready = Boolean(previewUrl && siteLink);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 3000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy(key: CopyKey, link: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(link);
      setCopyNote('');
      setCopied(key);
    } catch {
      setCopied(null);
      setCopyNote('Copying is not available here. Select the link above and copy it by hand.');
    }
  }

  if (!ready) {
    return (
      <span className="inline-flex items-center gap-2">
        <button type="button" disabled aria-describedby="preview-links-reason" className={BTN}>
          <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Preview links
        </button>
        <span id="preview-links-reason" className="text-xs text-text-muted">The preview is not ready yet.</span>
      </span>
    );
  }

  const statusText = [
    copied === 'page' ? 'Copied the link to this page.' : copied === 'site' ? 'Copied the link to the site.' : copyNote,
    email.isSuccess ? 'Sent to your email.' : '',
    email.isError ? previewLinkErrorText(email.error) : '',
  ].filter(Boolean).join(' ');
  const sendTarget = pageLink ? (path as string) : '/';
  const sendLabel = pageLink ? 'Email me this link' : 'Email me the site link';

  const linkRows: Array<{ key: CopyKey; label: string; href: string }> = [];
  if (pageLink) linkRows.push({ key: 'page', label: 'Open this page', href: pageLink });
  linkRows.push({ key: 'site', label: 'Open the site', href: siteLink as string });

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="preview-links-panel"
        onClick={() => setOpen((o) => !o)}
        className={BTN}
      >
        <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Preview links
      </button>
      {open && (
        <div
          id="preview-links-panel"
          role="group"
          aria-label="Preview links"
          className="absolute right-0 z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-border-warm bg-surface p-3 shadow-soft"
        >
          {linkRows.map((row) => (
            <div key={row.key} className={ROW}>
              <a href={row.href} target="_blank" rel="noopener noreferrer" aria-label={`${row.label} (opens in a new tab)`} className={cn(LINK, 'flex-1')}>
                {row.label}
              </a>
              <button
                type="button"
                className={BTN}
                aria-label={`${copied === row.key ? 'Copied' : 'Copy'} link to ${row.key === 'page' ? 'this page' : 'the site'}`}
                onClick={() => copy(row.key, row.href)}
              >
                {copied === row.key ? 'Copied' : 'Copy'}
              </button>
            </div>
          ))}
          {!pageLink && <p className="text-xs text-text-muted">The link to this page is not available, so only the site link is shown.</p>}
          <div className="border-t border-border-warm pt-3">
            <button
              type="button"
              className={BTN}
              disabled={email.isPending}
              onClick={() => email.mutate(sendTarget)}
            >
              {email.isPending ? 'Sending' : sendLabel}
            </button>
            {statusText && <p aria-hidden="true" className="mt-2 text-xs text-text-main">{statusText}</p>}
            <p className="mt-2 text-xs text-text-muted">This preview is not public. Do not forward it.</p>
          </div>
        </div>
      )}
      <div aria-live="polite" role="status" className="sr-only">{statusText}</div>
    </div>
  );
}
