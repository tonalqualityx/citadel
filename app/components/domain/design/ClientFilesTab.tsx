'use client';

import { ExternalLink, File as FileIcon, FileImage, FileSpreadsheet, FileText, Folder, Presentation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRefreshClientFiles, type ClientFileRef } from '@/lib/hooks/use-design-tray';
import { MAX_APPLY_FILES } from '@/lib/design/tray-limits';
import type { FeedEventLike } from './ChangesTab';

export interface ClientFileItem {
  id: string;
  name: string;
  mime: string;
  modified?: string | null;
  path?: string | null;
  webViewLink?: string | null;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** The newest `client_files` event, or null before any listing. */
export function latestClientFiles(events: FeedEventLike[]): { folder_id: string | null; items: ClientFileItem[] } | null {
  let best: FeedEventLike | null = null;
  for (const e of events) if (e.kind === 'client_files' && (!best || e.seq > best.seq)) best = e;
  if (!best) return null;
  const p = best.payload as { folder_id?: unknown; items?: unknown } | null;
  const items = Array.isArray(p?.items)
    ? (p!.items as unknown[]).filter((i): i is ClientFileItem => !!i && typeof (i as ClientFileItem).id === 'string' && typeof (i as ClientFileItem).name === 'string')
    : [];
  return { folder_id: typeof p?.folder_id === 'string' ? p.folder_id : null, items: items.map((i) => ({ ...i, mime: typeof i.mime === 'string' ? i.mime : '' })) };
}

export function driveLink(item: Pick<ClientFileItem, 'id' | 'mime' | 'webViewLink'>): string {
  if (item.webViewLink && /^https:\/\//.test(item.webViewLink)) return item.webViewLink;
  if (item.mime === FOLDER_MIME) return `https://drive.google.com/drive/folders/${item.id}`;
  return `https://drive.google.com/file/d/${item.id}/view`;
}

function MimeIcon({ mime }: { mime: string }) {
  const cls = 'h-4 w-4 shrink-0 text-text-sub';
  if (mime === FOLDER_MIME) return <Folder className={cls} aria-label="Folder" />;
  if (mime.startsWith('image/')) return <FileImage className={cls} aria-label="Image" />;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return <FileSpreadsheet className={cls} aria-label="Spreadsheet" />;
  if (mime.includes('presentation') || mime.includes('powerpoint')) return <Presentation className={cls} aria-label="Presentation" />;
  if (mime.includes('document') || mime.includes('pdf') || mime.startsWith('text/')) return <FileText className={cls} aria-label="Document" />;
  return <FileIcon className={cls} aria-label="File" />;
}

export interface ClientFilesTabProps {
  sessionId: string;
  events: FeedEventLike[];
  attached: ClientFileRef[];
  onAttach: (file: ClientFileRef) => void;
  onDetach: (id: string) => void;
  disabled?: boolean;
}

export function ClientFilesTab({ sessionId, events, attached, onAttach, onDetach, disabled }: ClientFilesTabProps) {
  const refresh = useRefreshClientFiles(sessionId);
  const listing = latestClientFiles(events);
  const attachedIds = new Set(attached.map((f) => f.id));

  const refreshButton = (
    <Button type="button" size="sm" variant="secondary" disabled={disabled || refresh.isPending} onClick={() => refresh.mutate()}>
      {refresh.isPending ? 'Refreshing...' : 'Refresh'}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-text-sub">Read only. Files you attach go to the worker with your next Apply.</p>
        {refreshButton}
      </div>

      {attached.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Attached to next Apply">
          {attached.map((f) => (
            <li key={f.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-text-main" data-testid="attach-chip">
              {f.name}
              <button type="button" aria-label={`Detach ${f.name}`} className="text-text-sub hover:text-text-main" onClick={() => onDetach(f.id)}>
                x
              </button>
            </li>
          ))}
        </ul>
      )}

      {!listing ? (
        <p className="text-sm text-text-sub" data-testid="client-files-empty">
          No client folder configured for this client, or it has not been listed yet. An admin sets the folder on the client page.
        </p>
      ) : listing.items.length === 0 ? (
        <p className="text-sm text-text-sub" data-testid="client-files-empty">
          The client folder is empty.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Client files">
          {listing.items.map((f) => {
            const isFolder = f.mime === FOLDER_MIME;
            const isAttached = attachedIds.has(f.id);
            const full = !isAttached && attached.length >= MAX_APPLY_FILES;
            return (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-border-warm bg-surface px-3 py-2" data-testid="client-file">
                <MimeIcon mime={f.mime} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-main">{f.name}</p>
                  <p className="truncate text-xs text-text-sub">
                    {f.path ? `${f.path} - ` : ''}
                    {f.modified ? new Date(f.modified).toLocaleDateString() : ''}
                  </p>
                </div>
                <a
                  href={driveLink(f)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  aria-label={`Open ${f.name} in Drive`}
                >
                  Open in Drive <ExternalLink className="h-3 w-3" />
                </a>
                {!isFolder && (
                  <Button
                    type="button"
                    size="sm"
                    variant={isAttached ? 'primary' : 'secondary'}
                    disabled={disabled || full}
                    aria-pressed={isAttached}
                    onClick={() => (isAttached ? onDetach(f.id) : onAttach({ id: f.id, name: f.name, mime: f.mime }))}
                  >
                    {isAttached ? 'Attached' : 'Attach to next Apply'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
