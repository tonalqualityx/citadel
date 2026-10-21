import { FileText, X } from 'lucide-react';
import { formatSize, type Draft } from './types';

// A file waiting in the composer: a thumbnail or a file icon, its name and size, upload progress,
// and a remove button until the message is sent.
export function AttachmentChip({ draft, onRemove }: { draft: Draft; onRemove: () => void }) {
  const uploading = !draft.id && !draft.error;
  return (
    <li className="att-chip" data-state={draft.error ? 'error' : uploading ? 'uploading' : 'ready'}>
      {draft.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={draft.preview} alt="" className="thumb" />
      ) : (
        <span className="thumb file" aria-hidden="true">
          <FileText className="i" focusable="false" />
        </span>
      )}
      <span className="att-body">
        <b>{draft.name}</b>
        <small>
          {draft.error ? draft.error : uploading ? `Uploading ${draft.progress}%` : formatSize(draft.size)}
        </small>
        {uploading ? <progress max={100} value={draft.progress} aria-label={`Uploading ${draft.name}`} /> : null}
      </span>
      <button type="button" className="att-x" onClick={onRemove} aria-label={`Remove ${draft.name}`}>
        <X className="i" aria-hidden="true" focusable="false" />
      </button>
    </li>
  );
}
