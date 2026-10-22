'use client';

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send as SendIcon, TriangleAlert, Upload } from 'lucide-react';
import { PortalButton } from '@/components/portal/ui/button';
import { Field } from '@/components/portal/ui/field';
import { useViewAs } from '@/components/portal/view-as-context';
import { AttachmentChip } from './attachment-chip';
import type { Draft } from './types';

// The message box: a Field and textarea, the attach button, Send, and the line that says the words
// are kept the moment they are sent. Files can be chosen or dropped on the box. When the assistant
// asks for a file (`wantsFile`) the drop area opens by itself.
/** True on a phone or tablet: Enter there is a new line, as on every phone keyboard. */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** True when the drag carries files (not selected text or a link being dragged around the page). */
export function dragHasFiles(e: Pick<React.DragEvent, 'dataTransfer'>): boolean {
  const types = e.dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

export function Composer({
  label, hint, value, onChange, onTyping, onSend, sending, error, drafts, onFiles, onRemoveFile, filesProblem, wantsFile, disabled, textareaRef,
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
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter and dragleave also fire for every child the pointer crosses, so a plain on/off flag
  // flickers. The depth counter goes up on each enter and down on each leave: dragging is true while it is above zero.
  const depth = useRef(0);
  function endDrag() {
    depth.current = 0;
    setDragging(false);
  }
  useEffect(() => {
    // A drag that ends outside the page (Escape, dropped elsewhere) sends no leave to the form.
    window.addEventListener('dragend', endDrag);
    window.addEventListener('drop', endDrag);
    return () => {
      window.removeEventListener('dragend', endDrag);
      window.removeEventListener('drop', endDrag);
    };
  }, []);
  const anyBusy = drafts.some((d) => !d.id && !d.error);
  const viewAs = useViewAs();
  const canSend = !viewAs && !disabled && !sending && !anyBusy && (value.trim().length > 0 || drafts.some((d) => d.id));

  function drop(e: React.DragEvent) {
    e.preventDefault();
    endDrag();
    if (viewAs) return;
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
      onDragEnter={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={drop}
    >
      {wantsFile && (
        <div className="drop" data-testid="chat-drop">
          <Upload className="i" aria-hidden="true" focusable="false" />
          <span>Drop a file here, or choose one with the paperclip.</span>
        </div>
      )}
      {/* One stable overlay: it sits over the box and ignores the pointer, so nothing moves under the cursor. */}
      {dragging && (
        <div className="drop-overlay" data-testid="chat-drop-active" aria-hidden="true">
          <Upload className="i" aria-hidden="true" focusable="false" />
          <span>Drop your file to attach it.</span>
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
          disabled={disabled || !!viewAs}
          onChange={(e) => {
            onChange(e.target.value);
            onTyping();
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
            // Desktop: Enter sends, Shift plus Enter adds a line. Phones (a coarse pointer) keep Enter as a new line.
            const send = e.metaKey || e.ctrlKey || (!e.shiftKey && !isCoarsePointer());
            if (send) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
      </Field>
      <p className="hint kbd-hint">Press Enter to send, or Shift and Enter for a new line.</p>
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
        <PortalButton writes variant="quiet" icon={Paperclip} onClick={() => fileInput.current?.click()} disabled={disabled}>
          Attach a file
        </PortalButton>
        <PortalButton writes type="submit" icon={SendIcon} busy={sending} busyLabel="Sending…" disabled={!canSend}>
          Send
        </PortalButton>
      </div>
    </form>
  );
}
