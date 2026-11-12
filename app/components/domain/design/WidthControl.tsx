'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import {
  DirectionError,
  directionKey,
  patchDirection,
  useDirection,
  type DirectionBody,
  type DirectionResponse,
} from '@/lib/hooks/use-design-direction';
import { CAP_RANGE, inRange, px, type ContainerMethod } from '@/lib/design/preview-tokens';

/** Candidate widest-content values (SPEC 4.2). The designer can also type her own. */
export const CAP_CHOICES = [1140, 1200, 1280, 1440] as const;

export interface GutterSet { id: string; label: string; phone: number; tablet: number; desktop: number }
export const GUTTER_SETS: readonly GutterSet[] = [
  { id: 'tight', label: 'Tight', phone: 16, tablet: 24, desktop: 32 },
  { id: 'standard', label: 'Standard', phone: 16, tablet: 32, desktop: 48 },
  { id: 'roomy', label: 'Roomy', phone: 24, tablet: 48, desktop: 72 },
];

const METHODS: ReadonlyArray<{ value: ContainerMethod; label: string; text: string }> = [
  { value: 'max_width', label: 'Centred cap', text: 'The content sits in a centred box that stops growing at the widest value.' },
  { value: 'padding_cap', label: 'Padding cap', text: 'Backgrounds run edge to edge and the content is held in by space on the sides.' },
];

type SavedContainer = NonNullable<DirectionBody['container']>;
type Gutters = { phone: number; tablet: number; desktop: number };
interface Picks { cap: number | null; gutters: Gutters | null; method: ContainerMethod | null }
const EMPTY: Picks = { cap: null, gutters: null, method: null };

function fromSaved(saved: SavedContainer | undefined): Picks {
  if (!saved) return EMPTY;
  const g = saved.gutters_px;
  return {
    cap: typeof saved.max_content_px === 'number' && inRange(saved.max_content_px, CAP_RANGE) ? saved.max_content_px : null,
    gutters:
      g && typeof g.phone === 'number' && typeof g.tablet === 'number' && typeof g.desktop === 'number'
        ? { phone: g.phone, tablet: g.tablet, desktop: g.desktop }
        : null,
    method: saved.method === 'max_width' || saved.method === 'padding_cap' ? saved.method : null,
  };
}

const sameGutters = (a: Gutters | null, b: Gutters) => !!a && a.phone === b.phone && a.tablet === b.tablet && a.desktop === b.desktop;

/** The token messages a set of picks stands for. `null` means "no override, show the built value". */
function tokensFor(p: Picks): Record<string, string | null> {
  return {
    '--maxw': p.cap == null ? null : px(p.cap),
    '--gutter-phone': p.gutters ? px(p.gutters.phone) : null,
    '--gutter-tablet': p.gutters ? px(p.gutters.tablet) : null,
    '--gutter-desktop': p.gutters ? px(p.gutters.desktop) : null,
    'container-method': p.method,
  };
}

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export interface WidthControlViewProps {
  /** Post one token to the frame (false when refused or the frame is not there yet). */
  sendToken: (name: string, value: string | null) => boolean;
  /** Changes whenever the frame loads a page; the current picks are posted again. */
  frameEpoch?: number;
  saved?: SavedContainer;
  /** Why saving is off, in plain words; null when saving is allowed. */
  saveOffReason: string | null;
  onSave?: (container: Record<string, unknown>) => Promise<void>;
}

export function WidthControlView({ sendToken, frameEpoch = 0, saved, saveOffReason, onSave }: WidthControlViewProps) {
  const [open, setOpen] = React.useState(false);
  const [picks, setPicks] = React.useState<Picks>(EMPTY);
  const [seeded, setSeeded] = React.useState(false);
  const [typed, setTyped] = React.useState<string | null>(null);
  const [save, setSave] = React.useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; text: string }>({ state: 'idle', text: '' });

  // Start from what the draft already holds, once, unless she has already picked something.
  if (!seeded && saved) {
    setSeeded(true);
    setPicks(fromSaved(saved));
  }
  const pick = (next: Partial<Picks>) => {
    setSeeded(true);
    setPicks((p) => ({ ...p, ...next }));
    setSave({ state: 'idle', text: '' });
  };

  // Post what changed; after a page load, post everything that is set (a fresh page has no overrides).
  const send = React.useRef(sendToken);
  React.useEffect(() => {
    send.current = sendToken;
  });
  const posted = React.useRef<Record<string, string | null>>({});
  const lastEpoch = React.useRef(frameEpoch);
  const tokens = React.useMemo(() => tokensFor(picks), [picks]);
  React.useEffect(() => {
    const fresh = lastEpoch.current !== frameEpoch;
    lastEpoch.current = frameEpoch;
    for (const [name, want] of Object.entries(tokens)) {
      const had = posted.current[name] ?? null;
      if (fresh ? want !== null : want !== had) send.current(name, want);
      posted.current[name] = want;
    }
  }, [tokens, frameEpoch]);

  const capText = typed ?? (picks.cap == null ? '' : String(picks.cap));
  const typedNumber = capText.trim() === '' ? null : Number(capText);
  const capError = typed !== null && capText.trim() !== '' && (typedNumber == null || !inRange(typedNumber, CAP_RANGE));

  const onType = (v: string) => {
    setTyped(v);
    setSave({ state: 'idle', text: '' });
    const n = v.trim() === '' ? NaN : Number(v);
    if (inRange(n, CAP_RANGE)) pick({ cap: n });
  };

  const gutterSets: GutterSet[] = React.useMemo(() => {
    const g = fromSaved(saved).gutters;
    if (!g || GUTTER_SETS.some((s) => sameGutters(g, s))) return [...GUTTER_SETS];
    return [...GUTTER_SETS, { id: 'saved', label: 'Saved', ...g }];
  }, [saved]);

  const anything = picks.cap != null || picks.gutters != null || picks.method != null;
  const summary = [
    picks.cap != null ? `${picks.cap}px wide` : null,
    picks.gutters ? `sides ${picks.gutters.phone}/${picks.gutters.tablet}/${picks.gutters.desktop}` : null,
    picks.method ? METHODS.find((m) => m.value === picks.method)?.label : null,
  ].filter(Boolean).join(', ');

  function reset() {
    setPicks(EMPTY);
    setSeeded(true);
    setTyped(null);
    setSave({ state: 'idle', text: '' });
  }

  async function doSave() {
    if (!onSave || saveOffReason || capError || !anything) return;
    const container: Record<string, unknown> = {};
    if (picks.cap != null) container.max_content_px = picks.cap;
    if (picks.method) container.method = picks.method;
    if (picks.gutters) container.gutters_px = { ...picks.gutters };
    setSave({ state: 'saving', text: 'Saving' });
    try {
      await onSave(container);
      setSave({ state: 'saved', text: 'Saved to the direction.' });
    } catch (e) {
      setSave({ state: 'error', text: e instanceof Error && e.message ? e.message : 'This could not be saved. Try again.' });
    }
  }

  const panelId = 'width-control-panel';
  return (
    <div className="flex flex-col gap-2" data-testid="width-control">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={open ? 'primary' : 'secondary'}
          className="min-h-[44px] sm:min-h-8"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          Width
        </Button>
        <span className="text-xs text-text-sub" data-testid="width-summary">
          {anything ? `Previewing ${summary}` : 'Showing the built page'}
        </span>
      </div>
      {open && (
        <div id={panelId} className="grid gap-4 rounded-lg border border-border-warm bg-surface p-3 text-sm text-text-main" role="group" aria-label="Page width">
          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-text-sub">Widest the content gets (px)</legend>
            <div className="flex flex-wrap items-center gap-2">
              {CAP_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={picks.cap === n}
                  onClick={() => { setTyped(null); pick({ cap: n }); }}
                  className={cn(
                    'min-h-[44px] rounded-md border border-border-warm px-3 text-xs font-medium sm:min-h-8',
                    focusRing,
                    picks.cap === n ? 'bg-primary text-white' : 'bg-surface text-text-sub hover:bg-background-light hover:text-text-main',
                  )}
                >
                  {n}
                </button>
              ))}
              <label htmlFor="width-control-number" className="text-xs text-text-sub">Or type a width</label>
              <input
                id="width-control-number"
                type="number"
                inputMode="numeric"
                value={capText}
                onChange={(e) => onType(e.target.value)}
                aria-invalid={capError ? true : undefined}
                aria-describedby="width-control-cap-help"
                className={cn('min-h-[44px] w-24 rounded-md border border-border-warm bg-surface px-2 text-sm sm:min-h-8', focusRing)}
              />
            </div>
            <p id="width-control-cap-help" role={capError ? 'alert' : undefined} className={cn('text-xs', capError ? 'text-red-700' : 'text-text-sub')}>
              {capError ? `Enter a whole number from ${CAP_RANGE[0]} to ${CAP_RANGE[1]}. The preview keeps the last width that worked.` : `From ${CAP_RANGE[0]} to ${CAP_RANGE[1]}.`}
            </p>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-text-sub">Space at the sides (phone / tablet / desktop, px)</legend>
            <div className="flex flex-wrap gap-2">
              {gutterSets.map((s) => {
                const on = sameGutters(picks.gutters, s);
                return (
                  <label key={s.id} className={cn('flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border-warm px-3 text-xs sm:min-h-8', on ? 'bg-background-light font-medium' : 'bg-surface')}>
                    <input type="radio" name="width-control-gutters" checked={on} onChange={() => pick({ gutters: { phone: s.phone, tablet: s.tablet, desktop: s.desktop } })} className={focusRing} />
                    <span>{s.label} {s.phone}/{s.tablet}/{s.desktop}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-xs font-medium text-text-sub">How the width is held</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {METHODS.map((m) => (
                <label key={m.value} className={cn('flex min-h-[44px] cursor-pointer items-start gap-2 rounded-md border border-border-warm p-2 text-xs', picks.method === m.value ? 'bg-background-light' : 'bg-surface')}>
                  <input type="radio" name="width-control-method" checked={picks.method === m.value} onChange={() => pick({ method: m.value })} className={cn('mt-0.5', focusRing)} />
                  <span><span className="block font-medium">{m.label}</span><span className="block text-text-sub">{m.text}</span></span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" className="min-h-[44px] sm:min-h-8" disabled={!!saveOffReason || capError || !anything || save.state === 'saving'} onClick={() => void doSave()}>
              Save to direction
            </Button>
            <Button type="button" size="sm" variant="secondary" className="min-h-[44px] sm:min-h-8" disabled={!anything && !seeded} onClick={reset}>
              Reset
            </Button>
            <p role="status" aria-live="polite" className="text-xs text-text-sub" data-testid="width-status">
              {saveOffReason ?? save.text}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export interface WidthControlProps {
  sendToken: (name: string, value: string | null) => boolean;
  frameEpoch?: number;
  /** The session whose art direction draft receives the pick. Null or missing: preview only. */
  sessionId?: string | null;
}

/** Preview-only when there is no session to save into. */
export function WidthControl({ sendToken, frameEpoch, sessionId }: WidthControlProps) {
  if (!sessionId) {
    return <WidthControlView sendToken={sendToken} frameEpoch={frameEpoch} saveOffReason="Saving is off: this project has no design direction yet, so the width is for previewing only." />;
  }
  return <ConnectedWidthControl sessionId={sessionId} sendToken={sendToken} frameEpoch={frameEpoch} />;
}

function ConnectedWidthControl({ sessionId, sendToken, frameEpoch }: { sessionId: string } & Omit<WidthControlProps, 'sessionId'>) {
  const qc = useQueryClient();
  const query = useDirection(sessionId);
  const direction = query.data?.direction ?? null;
  const signed = direction?.status === 'signed';
  const saveOffReason = signed
    ? 'Saving is off: the direction is signed off, so the width is for previewing only.'
    : !query.data
      ? 'Saving turns on once the direction has loaded.'
      : null;

  const onSave = async (container: Record<string, unknown>) => {
      try {
        // the revision on screen goes with the save, so a newer edit by the assistant is refused (version_moved), never overwritten
        const res = await patchDirection(sessionId, { container }, direction?.version ?? 0, direction?.revision);
        qc.setQueryData<DirectionResponse>(directionKey(sessionId), (prev) => (prev ? { ...prev, direction: res.direction } : prev));
        void qc.invalidateQueries({ queryKey: directionKey(sessionId) });
      } catch (e) {
        if (e instanceof DirectionError && (e.code === 'version_moved' || e.code === 'direction_signed')) {
          await qc.invalidateQueries({ queryKey: directionKey(sessionId) });
          throw new Error(e.code === 'version_moved' ? 'The direction was just updated. Try saving again.' : e.message);
        }
        throw e;
      }
  };

  return <WidthControlView sendToken={sendToken} frameEpoch={frameEpoch} saved={direction?.body?.container} saveOffReason={saveOffReason} onSave={onSave} />;
}
