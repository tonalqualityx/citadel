'use client';

import * as React from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UPLOAD_ACCEPT, refuseFile, uploadBoardFile, useAddUploadCard } from '@/lib/hooks/use-design-board';

type FileState = 'waiting' | 'uploading' | 'added' | 'refused' | 'failed';
interface Row { key: number; name: string; state: FileState; message?: string }

const STATE_WORDS: Record<FileState, string> = { waiting: 'Waiting', uploading: 'Uploading', added: 'Added to the board', refused: 'Not uploaded', failed: 'Did not upload' };

export interface UploadControls {
  /** Add files from a drop or the file picker. */
  addFiles: (files: File[]) => void;
  rows: Row[];
}

/** Sequential uploads: each file is checked first, sent, then given its own card. */
export function useBoardUploads(sessionId: string, usedSlots: number, onAnnounce: (m: string) => void): UploadControls {
  const addCard = useAddUploadCard(sessionId);
  const [rows, setRows] = React.useState<Row[]>([]);
  const counter = React.useRef(0);
  const chain = React.useRef<Promise<void>>(Promise.resolve());

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const addFiles = (files: File[]) => {
    let slots = usedSlots;
    for (const file of files) {
      const key = ++counter.current;
      const refusal = refuseFile(file, slots);
      if (refusal) {
        setRows((rs) => [...rs, { key, name: file.name, state: 'refused', message: refusal }]);
        continue;
      }
      slots += 1;
      setRows((rs) => [...rs, { key, name: file.name, state: 'waiting' }]);
      chain.current = chain.current.then(async () => {
        patch(key, { state: 'uploading' });
        try {
          const asset = await uploadBoardFile(sessionId, file);
          await addCard.mutateAsync([asset.id]);
          patch(key, { state: 'added', message: 'We are opening it now.' });
          onAnnounce(`${file.name} was added to the board.`);
        } catch (err) {
          patch(key, { state: 'failed', message: err instanceof Error ? err.message : 'The upload did not go through' });
        }
      });
    }
  };
  return { addFiles, rows };
}

export function UploadPanel({ controls }: { controls: UploadControls }) {
  const input = React.useRef<HTMLInputElement>(null);
  const hintId = React.useId();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" className="min-h-[44px] sm:min-h-10" onClick={() => input.current?.click()} aria-describedby={hintId}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          tabIndex={-1}
          className="sr-only"
          aria-label="Choose files to upload"
          onChange={(e) => { controls.addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
        />
        <p id={hintId} className="text-xs text-text-sub">You can also drop files anywhere on the board. PNG, JPEG, WebP, GIF or PDF, up to 25 MB each.</p>
      </div>
      {controls.rows.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Uploads" aria-live="polite">
          {controls.rows.map((r) => (
            <li key={r.key} data-testid="upload-row" className="text-sm text-text-main">
              <span className="font-medium">{r.name}</span>: {STATE_WORDS[r.state]}{r.message ? `. ${r.message}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
