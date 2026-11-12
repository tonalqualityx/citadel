'use client';

import * as React from 'react';
import { MessageSquare, Plus, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils/cn';
import {
  MARKUP_CATEGORY_LIST, MARKUP_SENTIMENT_LIST, safeAssetUrl, useCreateMarkup, useEditMarkup,
  type BoardAsset, type BoardMarkup, type MarkupCategory, type MarkupSentiment, type Rect,
} from '@/lib/hooks/use-design-board';
import { DEFAULT_BOX, KEY_STEP, describeRect, isBigEnough, moveRect, pointToFraction, rectFromPoints, resizeRect } from './markup-geometry';

export const NOTE_LIMIT = 500;

const SENTIMENT_WORD: Record<MarkupSentiment, string> = { like: 'Like', dislike: 'Dislike', note: 'Note' };
const SENTIMENT_ICON = { like: ThumbsUp, dislike: ThumbsDown, note: MessageSquare } as const;
const SENTIMENT_STYLE: Record<MarkupSentiment, string> = {
  like: 'border-green-600 border-solid',
  dislike: 'border-red-600 border-dashed',
  note: 'border-blue-600 border-dotted',
};
const CATEGORY_WORD: Record<MarkupCategory, string> = {
  type: 'Type', colour: 'Colour', layout: 'Layout', density: 'Density', imagery: 'Imagery', nav: 'Navigation',
  decoration: 'Decoration', motion: 'Motion', feature: 'Feature', tone: 'Tone', other: 'Other',
};

interface Active {
  /** null while the box is new and not saved yet. */
  id: string | null;
  rect: Rect;
  sentiment: MarkupSentiment | null;
  category: MarkupCategory | null;
  note: string;
}

type Gesture =
  | { kind: 'draw'; start: { x: number; y: number }; current: { x: number; y: number } }
  | { kind: 'move'; id: string | null; grab: { x: number; y: number }; origin: Rect; rect: Rect; moved: boolean };

export interface MarkupImageProps {
  sessionId: string;
  referenceId: string;
  asset: BoardAsset;
  /** Words for the picture, such as "Desktop view". */
  label: string;
  title: string;
  markups: BoardMarkup[];
}

/** One picture with its markup boxes. Boxes are kept as fractions of the picture, so they follow it when it is resized. */
export function MarkupImage({ sessionId, referenceId, asset, label, title, markups }: MarkupImageProps) {
  const src = safeAssetUrl(sessionId, asset.url);
  const create = useCreateMarkup(sessionId);
  const edit = useEditMarkup(sessionId);
  const surface = React.useRef<HTMLDivElement>(null);
  const boxRefs = React.useRef(new Map<string, HTMLDivElement>());
  const [active, setActive] = React.useState<Active | null>(null);
  const [gesture, setGesture] = React.useState<Gesture | null>(null);
  const gestureRef = React.useRef<Gesture | null>(null);
  const [announce, setAnnounce] = React.useState('');
  const [error, setError] = React.useState('');
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const uid = React.useId();

  const mine = markups.filter((m) => m.asset_id === asset.id);
  const busy = create.isPending || edit.isPending;

  React.useEffect(() => {
    if (!focusKey) return;
    boxRefs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey, active]);

  const setG = (g: Gesture | null) => {
    gestureRef.current = g;
    setGesture(g);
  };
  const pointer = (e: React.PointerEvent) => {
    const el = surface.current;
    return el ? pointToFraction(e.clientX, e.clientY, el.getBoundingClientRect()) : null;
  };

  const onSurfaceDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !src) return;
    const p = pointer(e);
    if (!p) return;
    try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* not supported */ }
    setG({ kind: 'draw', start: p, current: p });
  };

  const onBoxDown = (e: React.PointerEvent, id: string | null, rect: Rect) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = pointer(e);
    if (!p) return;
    try { surface.current?.setPointerCapture?.(e.pointerId); } catch { /* not supported */ }
    setG({ kind: 'move', id, grab: { x: p.x - rect.x, y: p.y - rect.y }, origin: rect, rect, moved: false });
  };

  const onMove = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    const p = pointer(e);
    if (!p) return;
    if (g.kind === 'draw') setG({ ...g, current: p });
    else {
      const next = moveRect(g.origin, p.x - g.grab.x - g.origin.x, p.y - g.grab.y - g.origin.y);
      setG({ ...g, rect: next, moved: next.x !== g.origin.x || next.y !== g.origin.y });
    }
  };

  const onUp = () => {
    const g = gestureRef.current;
    setG(null);
    if (!g) return;
    if (g.kind === 'draw') {
      const r = rectFromPoints(g.start, g.current);
      if (!isBigEnough(r)) return;
      setError('');
      setActive({ id: null, rect: r, sentiment: null, category: null, note: '' });
      setAnnounce(`New box drawn. ${describeRect(r)} Choose like, dislike or note, and a category.`);
      return;
    }
    if (!g.moved) {
      const m = g.id ? mine.find((x) => x.id === g.id) : null;
      if (m) open(m);
      return;
    }
    if (g.id === null) {
      setActive((a) => (a && a.id === null ? { ...a, rect: g.rect } : a));
    } else {
      const id = g.id;
      const m = mine.find((x) => x.id === id);
      if (m) setActive({ id, rect: g.rect, sentiment: m.sentiment, category: m.category, note: m.note ?? '' });
      edit.mutate({ markupId: id, referenceId, rect: g.rect }, { onError: (err) => setError(err instanceof Error ? err.message : 'Could not move the box') });
    }
    setAnnounce(describeRect(g.rect));
  };

  const open = (m: BoardMarkup) => {
    setError('');
    setActive({ id: m.id, rect: m.rect, sentiment: m.sentiment, category: m.category, note: m.note ?? '' });
  };

  const addBox = () => {
    setError('');
    setActive({ id: null, rect: DEFAULT_BOX, sentiment: null, category: null, note: '' });
    setFocusKey('new');
    setAnnounce(`New box placed. ${describeRect(DEFAULT_BOX)} Arrow keys move it. Shift with arrow keys changes its size.`);
  };

  const onBoxKey = (e: React.KeyboardEvent, id: string | null, rect: Rect) => {
    if (e.target !== e.currentTarget) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, -KEY_STEP], ArrowDown: [0, KEY_STEP] };
    const d = arrows[e.key];
    if (d) {
      e.preventDefault();
      const current = active && active.id === id ? active.rect : rect;
      const next = e.shiftKey ? resizeRect(current, d[0], d[1]) : moveRect(current, d[0], d[1]);
      if (active && active.id === id) setActive({ ...active, rect: next });
      else {
        const m = id ? mine.find((x) => x.id === id) : null;
        if (m) setActive({ id, rect: next, sentiment: m.sentiment, category: m.category, note: m.note ?? '' });
      }
      setAnnounce(describeRect(next));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const m = id ? mine.find((x) => x.id === id) : null;
      if (m) open(m);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const close = () => {
    const key = active?.id ?? 'new';
    setActive(null);
    setError('');
    if (active?.id) setFocusKey(key);
  };

  const save = () => {
    if (!active || !active.sentiment || !active.category) return;
    const note = active.note.trim();
    const fail = (err: unknown) => setError(err instanceof Error ? err.message : 'Could not save the box');
    if (active.id === null) {
      create.mutate({ reference_id: referenceId, asset_id: asset.id, rect: active.rect, sentiment: active.sentiment, category: active.category, ...(note ? { note } : {}) }, {
        onSuccess: () => { setActive(null); setError(''); setAnnounce('Box saved.'); },
        onError: fail,
      });
    } else {
      edit.mutate({ markupId: active.id, referenceId, rect: active.rect, sentiment: active.sentiment, category: active.category, note: note || null }, {
        onSuccess: () => { setActive(null); setError(''); setAnnounce('Box saved.'); },
        onError: fail,
      });
    }
  };

  const remove = () => {
    if (!active || active.id === null) return;
    edit.mutate({ markupId: active.id, referenceId, deleted: true }, {
      onSuccess: () => { setActive(null); setError(''); setAnnounce('Box deleted.'); },
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not delete the box'),
    });
  };

  if (!src) {
    return <p className="rounded-lg border border-border-warm bg-background-light p-3 text-xs text-text-sub">{label}: no picture to show yet.</p>;
  }

  // Boxes to draw: saved ones (the active one at its edited place), plus the new box.
  const shown: Array<{ key: string; id: string | null; rect: Rect; sentiment: MarkupSentiment | null; category: MarkupCategory | null; n: number }> = mine.map((m, i) => {
    const isActive = active?.id === m.id;
    const dragging = gesture?.kind === 'move' && gesture.id === m.id;
    return { key: m.id, id: m.id, rect: dragging ? gesture.rect : isActive ? active.rect : m.rect, sentiment: isActive ? active.sentiment ?? m.sentiment : m.sentiment, category: isActive ? active.category ?? m.category : m.category, n: i + 1 };
  });
  if (active && active.id === null) {
    const dragging = gesture?.kind === 'move' && gesture.id === null;
    shown.push({ key: 'new', id: null, rect: dragging ? gesture.rect : active.rect, sentiment: active.sentiment, category: active.category, n: mine.length + 1 });
  }
  const rubber = gesture?.kind === 'draw' ? rectFromPoints(gesture.start, gesture.current) : null;

  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-xs font-medium text-text-sub">{label}</figcaption>
      <div
        ref={surface}
        data-testid="markup-surface"
        className="relative select-none overflow-hidden rounded-lg border border-border-warm bg-background-light"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onSurfaceDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setG(null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${title}, ${label}`} draggable={false} className="block h-auto w-full" />
        {rubber && (
          <div aria-hidden="true" className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10" style={{ left: `${rubber.x * 100}%`, top: `${rubber.y * 100}%`, width: `${rubber.w * 100}%`, height: `${rubber.h * 100}%` }} />
        )}
        {shown.map((b) => {
          const Icon = b.sentiment ? SENTIMENT_ICON[b.sentiment] : Plus;
          const word = b.sentiment ? SENTIMENT_WORD[b.sentiment] : 'New';
          const isActive = (active?.id ?? null) === b.id && active !== null;
          return (
            <div
              key={b.key}
              ref={(el) => { if (el) boxRefs.current.set(b.key, el); else boxRefs.current.delete(b.key); }}
              role="button"
              tabIndex={0}
              data-testid="markup-box"
              data-rect={`${b.rect.x},${b.rect.y},${b.rect.w},${b.rect.h}`}
              aria-label={b.id === null
                ? 'New markup box, not saved. Arrow keys move it, Shift with arrow keys changes its size.'
                : `Markup box ${b.n}: ${word}${b.category ? `, ${CATEGORY_WORD[b.category]}` : ''}. Enter edits it, arrow keys move it, Shift with arrow keys changes its size.`}
              aria-pressed={isActive}
              className={cn('absolute cursor-move border-2 bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1', b.sentiment ? SENTIMENT_STYLE[b.sentiment] : 'border-primary border-solid', isActive && 'ring-2 ring-primary')}
              style={{ left: `${b.rect.x * 100}%`, top: `${b.rect.y * 100}%`, width: `${b.rect.w * 100}%`, height: `${b.rect.h * 100}%` }}
              onPointerDown={(e) => onBoxDown(e, b.id, b.rect)}
              onKeyDown={(e) => onBoxKey(e, b.id, b.rect)}
            >
              <span className="pointer-events-none absolute left-0 top-0 inline-flex items-center gap-1 bg-surface px-1 text-[0.7rem] font-medium text-text-main">
                <Icon className="h-3 w-3" aria-hidden="true" />
                {word}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" className="min-h-[44px] sm:min-h-8" onClick={addBox} aria-label={`Add a markup box on the ${label.toLowerCase()}`}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add a markup box
        </Button>
        <span className="text-xs text-text-sub">Or drag on the picture to draw one.</span>
      </div>
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      {active && (
        <fieldset className="mt-2 rounded-lg border border-border-warm bg-surface p-3" aria-describedby={`${uid}-help`}>
          <legend className="px-1 text-sm font-medium text-text-main">{active.id === null ? 'New markup box' : 'Edit markup box'}</legend>
          <p id={`${uid}-help`} className="text-xs text-text-sub">Move the box with the arrow keys. Hold Shift with the arrow keys to make it bigger or smaller.</p>

          <div role="radiogroup" aria-label="What do you think of this part" className="mt-2 flex flex-wrap gap-2">
            {MARKUP_SENTIMENT_LIST.map((s) => {
              const Icon = SENTIMENT_ICON[s];
              const on = active.sentiment === s;
              return (
                <label key={s} className={cn('inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm focus-within:ring-2 focus-within:ring-primary sm:min-h-9', on ? 'border-primary bg-primary/10 font-medium text-text-main' : 'border-border-warm text-text-sub')}>
                  <input type="radio" name={`${uid}-sentiment`} className="sr-only" checked={on} onChange={() => setActive({ ...active, sentiment: s })} />
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {SENTIMENT_WORD[s]}
                  {on && <span className="sr-only"> (chosen)</span>}
                </label>
              );
            })}
          </div>

          <div role="radiogroup" aria-label="What is it about" className="mt-2 flex flex-wrap gap-2">
            {MARKUP_CATEGORY_LIST.map((c) => {
              const on = active.category === c;
              return (
                <label key={c} className={cn('inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-3 text-sm focus-within:ring-2 focus-within:ring-primary sm:min-h-8', on ? 'border-primary bg-primary/10 font-medium text-text-main' : 'border-border-warm text-text-sub')}>
                  <input type="radio" name={`${uid}-category`} className="sr-only" checked={on} onChange={() => setActive({ ...active, category: c })} />
                  {CATEGORY_WORD[c]}
                  {on && <span className="sr-only"> (chosen)</span>}
                </label>
              );
            })}
          </div>

          <label htmlFor={`${uid}-note`} className="mt-3 block text-sm font-medium text-text-main">Note (optional)</label>
          <Textarea id={`${uid}-note`} className="mt-1 min-h-[56px]" value={active.note} maxLength={NOTE_LIMIT} onChange={(e) => setActive({ ...active, note: e.target.value.slice(0, NOTE_LIMIT) })} />
          <p className="mt-1 text-xs text-text-sub" data-testid="note-count">{active.note.length} of {NOTE_LIMIT} characters</p>

          {(!active.sentiment || !active.category) && <p id={`${uid}-need`} className="mt-2 text-xs text-text-sub">Choose like, dislike or note, and one category, to save.</p>}
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" className="min-h-[44px] sm:min-h-8" disabled={!active.sentiment || !active.category || busy} aria-describedby={!active.sentiment || !active.category ? `${uid}-need` : undefined} onClick={save}>Save box</Button>
            <Button type="button" size="sm" variant="secondary" className="min-h-[44px] sm:min-h-8" onClick={close}>{active.id === null ? 'Cancel' : 'Close'}</Button>
            {active.id !== null && <Button type="button" size="sm" variant="secondary" className="min-h-[44px] sm:min-h-8" disabled={busy} onClick={remove}>Delete box</Button>}
          </div>
        </fieldset>
      )}
    </figure>
  );
}
