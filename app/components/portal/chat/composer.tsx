'use client';

import { useRef, useState } from 'react';
import { Paperclip, Send as SendIcon, TriangleAlert, Upload } from 'lucide-react';
import { PortalButton } from '@/components/portal/ui/button';
import { Field } from '@/components/portal/ui/field';
import { AttachmentChip } from './attachment-chip';
import type { Draft } from './types';

// The message box: a Field and textarea, the attach button, Send, and the line that says the words
// are kept the moment they are sent. Files can be chosen or dropped on the box. When the assistant
// asks for a file (`wantsFile`) the drop area opens by itself.
export function Composer({
  label, hint, value, onChange, onTyping, onSend, sending, error, drafts, onFiles, onRemoveFile, filesProblem, wantsFile, disabled, noFiles, textareaRef,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onTyping: () => void;
  onSend: () => void;
  sending: boolean;
  error: string | null;
  drafts: Draft[];
  onFiles: (files: File[]) => void;
  onRemoveFile: (key: string) => void;
  filesProblem: string | null;
  wantsFile: boolean;
  disabled?: boolean;
  noFiles?: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const anyBusy = drafts.some((d) => !d.id && !d.error);
  const canSend = !disabled && !sending && !anyBusy && (value.trim().length > 0 || drafts.some((d) => d.id));

  function drop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) onFiles(files);
  }

  return (
    <form
      className="composer chat-composer"
      data-dragging={dragging || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
    >
      {(wantsFile || dragging) && (
        <div className="drop" data-testid="chat-drop">
          <Upload className="i" aria-hidden="true" focusable="false" />
          <span>{dragging ? 'Drop your file to attach it.' : 'Drop a file here, or choose one with the paperclip.'}</span>
        </div>
      )}
      {drafts.length > 0 && (
        <ul className="att-list" aria-label="Files to send">
          {drafts.map((d) => (
            <AttachmentChip key={d.key} draft={d} onRemove={() => onRemoveFile(d.key)} />
          ))}
        </ul>
      )}
      {filesProblem && (
        <p className="err" role="alert">
          <TriangleAlert className="i" aria-hidden="true" focusable="false" />
          {filesProblem}
        </p>
      )}
      <Field id="chat-message" label={label} hint={hint} error={error}>
        <textarea
          ref={textareaRef}
          value={value}
          rows={3}
          maxLength={4000}
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.value);
            onTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) {
              e.preventDefault();
              onSend();
            }
          }}
        />
      </Field>
      <div className="actions chat-actions">
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          data-testid="chat-file-input"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,application/pdf,.docx,.xlsx,.pptx,.txt,.csv"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFiles(files);
            e.target.value = '';
          }}
        />
        {!noFiles && <PortalButton variant="quiet" icon={Paperclip} onClick={() => fileInput.current?.click()} disabled={disabled}>
          Attach a file
        </PortalButton>}
        <PortalButton type="submit" icon={SendIcon} busy={sending} busyLabel="Sending…" disabled={!canSend}>
          Send
        </PortalButton>
      </div>
    </form>
  );
}
