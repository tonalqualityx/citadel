'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DirectionError, directionKey, patchDirection, reviseDirection, useDirection,
  type DirectionBody, type DirectionResponse,
} from '@/lib/hooks/use-design-direction';
import type { TrackTabProps } from '../track-tab-props';
import { DirectionForm } from './DirectionForm';
import { FieldContext, type FieldContextValue } from './fields';
import { SignOff } from './SignOff';
import { applyPending, buildPatch, keyOf, leaves, sameValue, getIn, signReasons, type Path, type Pending } from './direction-model';

const SAVE_DELAY_MS = 700;
const UPDATED_MS = 8000;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Two field keys cover each other when they are equal or one sits inside the other. */
const covers = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

const formatWhen = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
};

export function saveErrorMessage(e: unknown): string {
  if (e instanceof DirectionError) {
    const details = Array.isArray(e.details)
      ? (e.details as Array<{ path?: unknown[]; message?: string }>).map((d) => `${(d.path ?? []).join(' > ')}: ${d.message ?? ''}`.trim()).join(' ')
      : '';
    return details ? `${e.message}. ${details}` : e.message;
  }
  return 'Could not save. Check your connection.';
}

export function DirectionTab({ sessionId, track, feed }: TrackTabProps) {
  const qc = useQueryClient();
  const query = useDirection(sessionId, feed?.next_poll_ms);
  const data = query.data;
  const direction = data?.direction ?? null;
  const readOnly = direction?.status === 'signed';

  const [pending, setPendingState] = React.useState<Pending>({});
  const pendingRef = React.useRef<Pending>({});
  const dataRef = React.useRef<DirectionResponse | undefined>(undefined);
  dataRef.current = data;
  const focusedRef = React.useRef<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = React.useRef(false);
  const again = React.useRef(false);
  const alive = React.useRef(true);
  const ownKeys = React.useRef<Set<string>>(new Set());
  const [save, setSave] = React.useState<SaveState>('idle');
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [updated, setUpdated] = React.useState<string[]>([]);
  const updateTimers = React.useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const quotes = React.useRef<Record<string, string>>({});
  const [reviseError, setReviseError] = React.useState<string | null>(null);
  const [revising, setRevising] = React.useState(false);

  React.useEffect(() => {
    alive.current = true;
    const timers = updateTimers.current;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timers.forEach(clearTimeout);
    };
  }, []);

  const setPending = React.useCallback((next: Pending) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);

  for (const m of data?.missing_client_requests ?? []) quotes.current[m.id] = m.quote;

  // A save by the assistant arrives as an `art_direction` feed line: refetch at once, not on the next poll, so the form
  // shows the new text before she signs. Lines seen on the first render are already covered by the first load.
  const lastDirectionSeq = React.useMemo(() => {
    let max = 0;
    for (const e of feed?.events ?? []) if (e.kind === 'art_direction' && typeof e.seq === 'number' && e.seq > max) max = e.seq;
    return max;
  }, [feed?.events]);
  const seenDirectionSeq = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (seenDirectionSeq.current === null || lastDirectionSeq <= seenDirectionSeq.current) {
      seenDirectionSeq.current = Math.max(seenDirectionSeq.current ?? 0, lastDirectionSeq);
      return;
    }
    seenDirectionSeq.current = lastDirectionSeq;
    void qc.invalidateQueries({ queryKey: directionKey(sessionId) });
  }, [lastDirectionSeq, qc, sessionId]);

  // Live updates: mark the fields that changed under the designer, except the ones she is editing or just saved.
  const prevLeaves = React.useRef<{ id: string; leaves: Record<string, string> } | null>(null);
  React.useEffect(() => {
    if (!direction) return;
    const next = leaves(direction.body);
    const prev = prevLeaves.current;
    prevLeaves.current = { id: direction.id, leaves: next };
    if (!prev || prev.id !== direction.id) return;
    const changed = [...new Set([...Object.keys(prev.leaves), ...Object.keys(next)])].filter((k) => prev.leaves[k] !== next[k]);
    const marks = changed.filter((k) => {
      const f = focusedRef.current;
      if (f && covers(f, k)) return false;
      if ([...ownKeys.current].some((o) => covers(o, k))) return false;
      return !Object.keys(pendingRef.current).some((p) => covers(p, k));
    });
    ownKeys.current.clear();
    if (marks.length === 0) return;
    setUpdated((u) => [...new Set([...u, ...marks])]);
    updateTimers.current.push(setTimeout(() => alive.current && setUpdated((u) => u.filter((k) => !marks.includes(k))), UPDATED_MS));
  }, [direction]);

  const prune = React.useCallback(() => {
    const saved = dataRef.current?.direction?.body;
    const next: Pending = {};
    for (const [k, e] of Object.entries(pendingRef.current)) {
      const f = focusedRef.current;
      const settled = sameValue(getIn(saved, e.path), e.value);
      if (!settled || (f && covers(f, k))) next[k] = e;
    }
    if (Object.keys(next).length !== Object.keys(pendingRef.current).length) setPending(next);
  }, [setPending]);

  const flush = React.useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inFlight.current) { again.current = true; return; }
    const current = dataRef.current?.direction;
    if (current?.status === 'signed') return;
    const { patch, keys } = buildPatch(current?.body, pendingRef.current);
    if (keys.length === 0) { prune(); return; }
    const base = current?.version ?? 0;
    const sent = keys.map((k) => ({ k, value: pendingRef.current[k].value }));
    inFlight.current = true;
    setSave('saving');
    setSaveError(null);
    try {
      // The revision of the direction this form holds; the response carries the next one (set into the cache below).
      const res = await patchDirection(sessionId, patch, base, current?.revision);
      keys.forEach((k) => ownKeys.current.add(k));
      qc.setQueryData<DirectionResponse>(directionKey(sessionId), (prev) => (prev ? { ...prev, direction: res.direction } : prev));
      dataRef.current = qc.getQueryData<DirectionResponse>(directionKey(sessionId));
      const next = { ...pendingRef.current };
      for (const s of sent) if (next[s.k] && sameValue(next[s.k].value, s.value) && !(focusedRef.current && covers(focusedRef.current, s.k))) delete next[s.k];
      if (alive.current) { setPending(next); setSave('saved'); }
      void qc.invalidateQueries({ queryKey: directionKey(sessionId) });
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof DirectionError && (e.code === 'version_moved' || e.code === 'direction_signed')) {
        setNotice(e.code === 'version_moved' ? 'This was just updated. Here is the latest.' : e.message);
        // Keep only the field she is typing in; everything else shows the latest saved text.
        const f = focusedRef.current;
        const keep: Pending = {};
        for (const [k, p] of Object.entries(pendingRef.current)) if (f && covers(f, k)) keep[k] = p;
        setPending(keep);
        setSave('idle');
        await qc.invalidateQueries({ queryKey: directionKey(sessionId) });
      } else {
        setSave('error');
        setSaveError(saveErrorMessage(e));
      }
    } finally {
      inFlight.current = false;
      if (again.current && alive.current) { again.current = false; void flush(); }
    }
  }, [qc, sessionId, setPending, prune]);

  const set = React.useCallback((path: Path, value: unknown) => {
    setNotice(null);
    setPending({ ...pendingRef.current, [keyOf(path)]: { path, value: value ?? null } });
    setSave('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush, setPending]);

  const ctx = React.useMemo<FieldContextValue>(() => ({
    readOnly,
    onFocus: (p) => { focusedRef.current = keyOf(p); },
    onBlur: (p) => { if (focusedRef.current === keyOf(p)) focusedRef.current = null; void flush(); },
    isUpdated: (p) => updated.some((k) => covers(k, keyOf(p))),
  }), [readOnly, flush, updated]);

  const body = React.useMemo<DirectionBody>(() => applyPending(direction?.body, pending), [direction?.body, pending]);
  const missing = data?.missing_client_requests ?? [];
  const dirty = Object.values(pending).some((e) => !sameValue(getIn(direction?.body, e.path), e.value));
  const reasons = React.useMemo(() => {
    const r = signReasons(body, missing.length);
    if (dirty || save === 'saving') r.push('Your latest changes are still saving.');
    return r;
  }, [body, missing.length, dirty, save]);

  const answer = (id: string) => set(['client_requests'], [...(body.client_requests ?? []), { design_note_id: id, how_honoured: '' }]);

  async function revise() {
    setRevising(true);
    setReviseError(null);
    try {
      await reviseDirection(sessionId);
      await qc.invalidateQueries({ queryKey: directionKey(sessionId) });
    } catch (e) {
      setReviseError(e instanceof DirectionError ? e.message : 'Could not start a revision. Try again.');
    } finally {
      setRevising(false);
    }
  }

  if (query.isLoading) return <p className="p-4 text-sm text-text-sub" role="status">Loading the direction</p>;
  if (query.isError && !data) {
    return <p className="p-4 text-sm text-red-700" role="alert">Could not load the direction. It will try again shortly.</p>;
  }

  const canRevise = readOnly && (track.stage === 'refine' || track.stage === 'review' || (track.stage === 'home_build' && !track.busy));
  const statusText = save === 'saving' ? 'Saving' : save === 'saved' ? 'Saved' : save === 'error' ? 'Not saved' : '';

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4" data-testid="direction-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-text-main">Art direction</h2>
        {!readOnly && <p role="status" aria-live="polite" className="text-sm text-text-sub" data-testid="save-status">{statusText}</p>}
      </div>
      {notice && <p role="status" aria-live="polite" className="rounded-lg bg-background-light p-3 text-sm text-text-main" data-testid="direction-notice">{notice}</p>}
      {saveError && <p role="alert" className="rounded-lg border border-red-300 p-3 text-sm text-red-700">{saveError}</p>}

      {readOnly && direction && (
        <div className="rounded-xl border border-border-warm bg-surface p-4" data-testid="signed-banner">
          <p className="text-sm font-medium text-text-main">
            Signed{direction.signed_at ? ` on ${formatWhen(direction.signed_at)}` : ''} by the designer on this project. This is version {direction.version}, and it can no longer be edited.
          </p>
          {canRevise && (
            <div className="mt-3">
              <Button type="button" variant="secondary" className="min-h-[44px] sm:min-h-0" disabled={revising} onClick={revise}>Revise direction</Button>
              <p className="mt-1 text-xs text-text-sub">Revising starts a new draft from this version. Nothing changes until you sign it.</p>
            </div>
          )}
          {reviseError && <p role="alert" className="mt-2 text-sm text-red-700">{reviseError}</p>}
        </div>
      )}

      <FieldContext.Provider value={ctx}>
        <DirectionForm body={body} set={set} quotes={quotes.current} />
      </FieldContext.Provider>

      {!readOnly && direction && (
        <SignOff sessionId={sessionId} direction={direction} stage={track.stage} missing={missing} reasons={reasons} onAnswer={answer} />
      )}
      {!readOnly && !direction && (
        <p className="text-sm text-text-sub">Sign off becomes available once the first notes are saved.</p>
      )}
    </div>
  );
}
