'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalBody, ModalFooter } from '@/components/ui/modal';
import { PinItem, pinTitle } from './PinItem';
import type { BridgeDraft } from '@/lib/hooks/use-design-bridge';
import {
  ApplyError,
  newClientRef,
  useApplyPins,
  useCreatePin,
  usePatchPin,
  type ClientFileRef,
  type TrayPin,
} from '@/lib/hooks/use-design-tray';
import { showToast } from '@/lib/hooks/use-toast';
import { MAX_APPLY_PINS } from '@/lib/design/tray-limits';

export interface TrayProps {
  sessionId: string;
  /** Pins from the session load (all statuses; the tray shows pending and follow-up ones). */
  pins: TrayPin[];
  /** The session's current preview sha, to flag pins taken on an older preview. */
  previewSha: string | null;
  drafts: BridgeDraft[];
  onRemoveDraft: (id: string) => void;
  onHighlight?: (selector: string) => void;
  attachedFiles: ClientFileRef[];
  onDetachFile: (id: string) => void;
  onApplied?: () => void;
  disabled?: boolean;
}

function DraftRow({ draft, busy, onAdd, onDrop }: { draft: BridgeDraft; busy: boolean; onAdd: (note: string) => void; onDrop: () => void }) {
  const [note, setNote] = React.useState('');
  const d = draft.draft;
  return (
    <li className="rounded-lg border border-dashed border-border-warm bg-surface p-3" data-testid="draft-item">
      <p className="truncate text-sm font-medium text-text-main">{pinTitle({ data_lib: d.data_lib, tag: d.tag, page_path: d.path })}</p>
      {d.text_quote && <p className="mt-1 truncate text-xs text-text-sub">&ldquo;{d.text_quote}&rdquo;</p>}
      <Textarea
        aria-label="Note for the new pin"
        className="mt-2 min-h-[56px]"
        placeholder="What should change here? (optional)"
        value={note}
        maxLength={4000}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => onAdd(note)}>
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDrop}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}

export function Tray({ sessionId, pins, previewSha, drafts, onRemoveDraft, onHighlight, attachedFiles, onDetachFile, onApplied, disabled }: TrayProps) {
  const createPin = useCreatePin(sessionId);
  const patchPin = usePatchPin(sessionId);
  const apply = useApplyPins(sessionId);
  const [applyNote, setApplyNote] = React.useState('');
  const [stale, setStale] = React.useState<{ ids: string[]; input: { pin_ids: string[] } } | null>(null);

  const visible = pins.filter((p) => p.status === 'pending' || p.status === 'followup');
  const pending = visible.filter((p) => p.status === 'pending');
  const unsaved = drafts.length;

  // Leaving the page with pins in the tray (saved or not) loses nothing server-side, but the designer is told.
  React.useEffect(() => {
    if (pending.length === 0 && unsaved === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [pending.length, unsaved]);

  const isStale = (p: TrayPin) => !!previewSha && p.preview_sha !== previewSha;

  const submit = (pinIds: string[]) => {
    const files = attachedFiles.length > 0 ? attachedFiles : undefined;
    apply.mutate(
      { client_ref: newClientRef(), pin_ids: pinIds, ...(applyNote.trim() ? { note: applyNote.trim() } : {}), ...(files ? { files } : {}) },
      {
        onSuccess: () => {
          setApplyNote('');
          setStale(null);
          onApplied?.();
          showToast.success('Sent to the worker');
        },
        onError: (error) => {
          if (error instanceof ApplyError && error.code === 'stale_pins') setStale({ ids: error.stalePinIds, input: { pin_ids: pinIds } });
        },
      },
    );
  };

  const onApply = () => submit(pending.slice(0, MAX_APPLY_PINS).map((p) => p.id));

  const removeStaleAndApply = async () => {
    if (!stale) return;
    const staleIds = new Set(stale.ids);
    try {
      await Promise.all(stale.ids.map((id) => patchPin.mutateAsync({ id, status: 'discarded' })));
    } catch {
      return;
    }
    const rest = stale.input.pin_ids.filter((id) => !staleIds.has(id));
    setStale(null);
    if (rest.length > 0) submit(rest);
  };

  const stalePins = stale ? pending.filter((p) => stale.ids.includes(p.id)) : [];

  return (
    <div className="flex flex-col gap-3 p-1" data-testid="tray">
      {drafts.length > 0 && (
        <section aria-label="New pins">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-sub">New pins</h3>
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => (
              <DraftRow
                key={d.id}
                draft={d}
                busy={createPin.isPending}
                onAdd={(note) => createPin.mutate({ draft: d.draft, note }, { onSuccess: () => onRemoveDraft(d.id) })}
                onDrop={() => onRemoveDraft(d.id)}
              />
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Pins">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-sub">Pins ({pending.length})</h3>
        {visible.length === 0 ? (
          <p className="text-sm text-text-sub">No pins yet. Turn on select mode and click an element in the preview.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((p) => (
              <PinItem
                key={p.id}
                pin={p}
                stale={p.status === 'pending' && isStale(p)}
                busy={patchPin.isPending}
                onHighlight={(pin) => onHighlight?.(pin.selector)}
                onNote={(pin, note) => patchPin.mutate({ id: pin.id, note })}
                onDiscard={(pin) => patchPin.mutate({ id: pin.id, status: 'discarded' })}
                onFollowup={(pin) => patchPin.mutate({ id: pin.id, status: 'followup' })}
              />
            ))}
          </ul>
        )}
      </section>

      {attachedFiles.length > 0 && (
        <section aria-label="Attached client files">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-sub">Attached to this Apply</h3>
          <ul className="flex flex-wrap gap-1.5">
            {attachedFiles.map((f) => (
              <li key={f.id} className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-2.5 py-0.5 text-xs text-text-main">
                {f.name}
                <button type="button" aria-label={`Detach ${f.name}`} className="text-text-sub hover:text-text-main" onClick={() => onDetachFile(f.id)}>
                  x
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Textarea
        aria-label="Note for the worker"
        className="min-h-[56px]"
        placeholder="Anything to add for the worker? (optional)"
        value={applyNote}
        maxLength={4000}
        onChange={(e) => setApplyNote(e.target.value)}
      />
      <Button type="button" disabled={disabled || pending.length === 0 || apply.isPending} onClick={onApply}>
        {apply.isPending ? 'Applying...' : `Apply${pending.length > 0 ? ` (${Math.min(pending.length, MAX_APPLY_PINS)})` : ''}`}
      </Button>
      {pending.length > MAX_APPLY_PINS && (
        <p className="text-xs text-text-sub">Apply sends {MAX_APPLY_PINS} pins at a time. The rest stay in the tray.</p>
      )}

      <Modal open={stale !== null} onOpenChange={(open) => !open && setStale(null)}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>Some pins are from an older preview</ModalTitle>
            <ModalDescription>The preview changed after these pins were taken, so they may point at things that moved.</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <ul className="flex flex-col gap-1.5 text-sm text-text-main" data-testid="stale-list">
              {(stalePins.length > 0 ? stalePins.map((p) => ({ id: p.id, label: pinTitle(p) })) : (stale?.ids ?? []).map((id) => ({ id, label: id }))).map((s) => (
                <li key={s.id}>{s.label}</li>
              ))}
            </ul>
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => setStale(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={patchPin.isPending || apply.isPending} onClick={removeStaleAndApply}>
              Remove them and apply
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
