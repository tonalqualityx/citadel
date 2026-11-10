'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { DirectionBody, DirectionFeature, DirectionFlair, DirectionLink } from '@/lib/hooks/use-design-direction';
import { ContainerFields } from './ContainerFields';
import { LinesInput, SelectInput, TextInput, YES_NO } from './fields';
import { getIn, type Path } from './direction-model';

export interface DirectionFormProps {
  /** The body as shown: the saved record with the designer's unsaved edits on top. */
  body: DirectionBody;
  /** Set a field (null removes it). */
  set: (path: Path, value: unknown) => void;
  /** Quotes of client requests seen so far, by note id. */
  quotes: Record<string, string>;
}

function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border-warm bg-surface p-4">
      <h3 id={id} className="text-base font-semibold text-text-main">{title}</h3>
      {hint && <p className="mt-1 text-sm text-text-sub">{hint}</p>}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

const words = (s: string | undefined) => (s && s.trim() ? s.trim().split(/\s+/).length : 0);

const REGISTER = [{ value: 'quiet', label: 'Quiet' }, { value: 'bold', label: 'Bold' }];
const SOURCE = [{ value: 'brand', label: 'The brand already uses it' }, { value: 'designer', label: 'My choice' }, { value: 'reference-derived', label: 'Taken from a reference' }];
const IMAGE_KIND = [{ value: 'photo', label: 'Photos' }, { value: 'illustration', label: 'Illustration' }, { value: 'mixed', label: 'A mix' }];
const DENSITY = [{ value: 'airy', label: 'Airy' }, { value: 'balanced', label: 'Balanced' }, { value: 'dense', label: 'Dense' }];
const NAV_DESKTOP = [
  { value: 'inline', label: 'Logo left, links inline' }, { value: 'centered_logo', label: 'Logo centred' },
  { value: 'split', label: 'Links split around the logo' }, { value: 'mega', label: 'Large drop-down menus' },
];
const NAV_MOBILE = [
  { value: 'drawer_right', label: 'Drawer from the right' }, { value: 'drawer_left', label: 'Drawer from the left' },
  { value: 'full_screen', label: 'Full-screen menu' }, { value: 'bottom_bar', label: 'Bar at the bottom' },
];
const TRIGGER = [{ value: 'icon_with_label', label: 'Icon with the word Menu' }, { value: 'icon', label: 'Icon only' }];
const BUILD_AS = [{ value: 'new_component', label: 'A new component' }, { value: 'variant', label: 'A variant of a component' }, { value: 'module', label: 'A separate module' }];
const FLAIR_KIND = [
  { value: 'semi_transparent_ground', label: 'See-through background' }, { value: 'angled_edge', label: 'Angled edge' }, { value: 'overlap', label: 'Overlap' },
  { value: 'illustration_behind', label: 'Illustration behind content' }, { value: 'texture', label: 'Texture' }, { value: 'pattern', label: 'Pattern' }, { value: 'other', label: 'Something else' },
];
const INTENSITY = [{ value: 'subtle', label: 'Subtle' }, { value: 'medium', label: 'Medium' }, { value: 'strong', label: 'Strong' }];
const PHONE = [{ value: 'keep', label: 'Keep as is' }, { value: 'reduce', label: 'Reduce' }, { value: 'hide', label: 'Hide' }];
const MOTION = [{ value: 'none', label: 'None' }, { value: 'subtle', label: 'Subtle' }, { value: 'some', label: 'Some' }];

/** A list of records (links, features, flair): edits replace the whole array, which is how the server merges arrays. */
function ItemList<T extends object>({ path, items, onChange, title, addLabel, makeNew, children }: {
  path: Path; items: T[] | undefined; onChange: (v: T[] | null) => void; title: (item: T, i: number) => string; addLabel?: string;
  makeNew?: (items: T[]) => T; children: (item: T, i: number, update: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  const list = items ?? [];
  const replace = (next: T[]) => onChange(next.length ? next : null);
  return (
    <div className="space-y-3">
      {list.map((item, i) => (
        <fieldset key={i} className="rounded-lg border border-border-warm p-3" data-item={`${path.join('.')}.${i}`}>
          <legend className="px-1 text-sm font-medium text-text-main">{title(item, i)}</legend>
          <div className="space-y-3">{children(item, i, (patch) => replace(list.map((x, j) => (j === i ? { ...x, ...patch } : x))))}</div>
          <div className="mt-3">
            <Button type="button" variant="secondary" size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => replace(list.filter((_, j) => j !== i))}>
              Remove {title(item, i)}
            </Button>
          </div>
        </fieldset>
      ))}
      {addLabel && makeNew && (
        <Button type="button" variant="secondary" size="sm" className="min-h-[44px] sm:min-h-0" onClick={() => replace([...list, makeNew(list)])}>{addLabel}</Button>
      )}
    </div>
  );
}

const nextId = (prefix: string, items: Array<{ id: string }>) => {
  const used = new Set(items.map((x) => x.id));
  let n = items.length + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

function LinkFields({ path, value, onChange, labelText }: { path: Path; value: DirectionLink; onChange: (v: DirectionLink) => void; labelText: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextInput path={path} label={`${labelText}: words shown`} value={value.label} onChange={(v) => onChange({ ...value, label: v ?? '' })} />
      <TextInput path={path} label={`${labelText}: where it goes`} value={value.url} onChange={(v) => onChange({ ...value, url: v ?? '' })} hint="A path such as /shop/ or a full https address." />
    </div>
  );
}

export function DirectionForm({ body, set, quotes }: DirectionFormProps) {
  const g = <V,>(path: Path) => getIn(body, path) as V | undefined;
  const T = (path: Path, label: string, o: { multiline?: boolean; hint?: string } = {}) => (
    <TextInput path={path} label={label} value={g<string>(path)} onChange={(v) => set(path, v)} {...o} />
  );
  const S = <V extends string | boolean>(path: Path, label: string, options: Array<{ value: V; label: string }>) => (
    <SelectInput<V> path={path} label={label} value={g<V>(path)} options={options} onChange={(v) => set(path, v)} />
  );
  const L = (path: Path, label: string, separator: 'line' | 'comma' = 'line', hint?: string) => (
    <LinesInput path={path} label={label} separator={separator} value={g<string[]>(path)} onChange={(v) => set(path, v)} hint={hint} />
  );
  const summaryWords = words(body.summary);
  const cta = g<DirectionLink>(['nav', 'desktop', 'cta']) ?? {};
  const setCta = (v: DirectionLink) => set(['nav', 'desktop', 'cta'], v.label || v.url ? v : null);

  return (
    <div className="space-y-4">
      <Section title="Summary" hint="The direction in plain language, in 120 words or fewer.">
        <TextInput
          path={['summary']} label="Summary" multiline value={body.summary} onChange={(v) => set(['summary'], v)}
          error={summaryWords > 120 ? `That is ${summaryWords} words. The most it can be is 120.` : null}
          hint={`${summaryWords} of 120 words`}
        />
      </Section>

      <Section title="Feel">
        {L(['feel', 'words'], 'Words for the feel', 'comma', 'Up to 12 words, separated by commas.')}
        {S(['feel', 'register'], 'Overall register', REGISTER)}
        {T(['feel', 'detail'], 'Notes', { multiline: true })}
      </Section>

      <Section title="Type">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-main">Headline font</p>
            {T(['type', 'display', 'family'], 'Font family')}
            {S(['type', 'display', 'source'], 'Where it comes from', SOURCE)}
            {T(['type', 'display', 'why'], 'Why this font', { multiline: true })}
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-main">Body font</p>
            {T(['type', 'body', 'family'], 'Font family')}
            {S(['type', 'body', 'source'], 'Where it comes from', SOURCE)}
            {T(['type', 'body', 'why'], 'Why this font', { multiline: true })}
          </div>
        </div>
        {T(['type', 'detail'], 'Notes on scale, case and spacing', { multiline: true })}
      </Section>

      <Section title="Colour">
        {L(['colour', 'brand_tokens_kept'], 'Brand colours kept', 'line', 'One colour name per line.')}
        {T(['colour', 'accent_job'], 'What the accent colour is for')}
        {L(['colour', 'grounds'], 'Background colours', 'comma')}
        {L(['colour', 'avoid'], 'Colours to avoid', 'comma')}
      </Section>

      <Section title="Imagery">
        {S(['imagery', 'kind'], 'Kind of imagery', IMAGE_KIND)}
        {T(['imagery', 'treatment'], 'Treatment', { multiline: true })}
        {T(['imagery', 'subjects'], 'Subjects', { multiline: true })}
        {T(['imagery', 'avoid'], 'Avoid', { multiline: true })}
      </Section>

      <Section title="Layout">
        {S(['layout', 'density'], 'How full the pages feel', DENSITY)}
        {T(['layout', 'detail'], 'Notes', { multiline: true })}
      </Section>

      <Section title="Navigation" hint="Both the desktop and the phone navigation are needed before sign-off.">
        <h4 className="text-sm font-semibold text-text-main">Desktop</h4>
        {S(['nav', 'desktop', 'pattern'], 'Desktop navigation', NAV_DESKTOP)}
        <ItemList<DirectionLink>
          path={['nav', 'desktop', 'items']} items={g<DirectionLink[]>(['nav', 'desktop', 'items'])} onChange={(v) => set(['nav', 'desktop', 'items'], v)}
          title={(item, i) => item.label || `Link ${i + 1}`} addLabel="Add a link" makeNew={() => ({ label: '', url: '' })}
        >
          {(item, _i, update) => <LinkFields path={['nav', 'desktop', 'items']} value={item} onChange={(v) => update(v)} labelText="Link" />}
        </ItemList>
        <LinkFields path={['nav', 'desktop', 'cta']} value={cta} onChange={setCta} labelText="Button" />
        {L(['nav', 'desktop', 'utility'], 'Extras beside the links', 'comma', 'For example: cart, account, search.')}
        {S(['nav', 'desktop', 'sticky'], 'Stays at the top while scrolling', YES_NO)}
        <h4 className="pt-2 text-sm font-semibold text-text-main">Phone</h4>
        {S(['nav', 'mobile', 'pattern'], 'Phone navigation', NAV_MOBILE)}
        {S(['nav', 'mobile', 'trigger'], 'Menu button', TRIGGER)}
        {L(['nav', 'mobile', 'always_visible'], 'Always visible on phones', 'comma', 'For example: cart.')}
        {S(['nav', 'mobile', 'cta_in_drawer'], 'Button inside the menu', YES_NO)}
        {S(['nav', 'mobile', 'sticky'], 'Stays at the top while scrolling', YES_NO)}
      </Section>

      <Section title="Page width" hint="How wide the content runs. A width is needed before sign-off.">
        <ContainerFields value={body.container} onChange={(rel, v) => set(['container', ...rel], v)} />
      </Section>

      <Section title="Features">
        <ItemList<DirectionFeature>
          path={['features']} items={body.features} onChange={(v) => set(['features'], v)}
          title={(f, i) => f.name || `Feature ${i + 1}`} addLabel="Add a feature" makeNew={(l) => ({ id: nextId('f', l), name: '', build_as: 'new_component' })}
        >
          {(f, _i, update) => (
            <>
              <TextInput path={['features']} label="Name" value={f.name} onChange={(v) => update({ name: v ?? '' })} />
              <TextInput path={['features']} label="What it does" multiline value={f.what} onChange={(v) => update({ what: v ?? undefined })} />
              <LinesInput path={['features']} label="Pages it appears on" separator="comma" value={f.pages} onChange={(v) => update({ pages: v ?? undefined })} />
              <SelectInput path={['features']} label="How it is built" value={f.build_as} options={BUILD_AS} onChange={(v) => update({ build_as: v ?? 'new_component' })} />
              <TextInput path={['features']} label="Accessibility notes" value={f.a11y} onChange={(v) => update({ a11y: v ?? undefined })} />
            </>
          )}
        </ItemList>
      </Section>

      <Section title="Flair">
        <ItemList<DirectionFlair>
          path={['flair']} items={body.flair} onChange={(v) => set(['flair'], v)}
          title={(f, i) => f.where || `Flair ${i + 1}`} addLabel="Add flair" makeNew={(l) => ({ id: nextId('fl', l), kind: 'other' })}
        >
          {(f, _i, update) => (
            <>
              <SelectInput path={['flair']} label="Kind" value={f.kind} options={FLAIR_KIND} onChange={(v) => update({ kind: v ?? 'other' })} />
              <TextInput path={['flair']} label="Where it goes" value={f.where} onChange={(v) => update({ where: v ?? undefined })} />
              <SelectInput path={['flair']} label="How strong" value={f.intensity} options={INTENSITY} onChange={(v) => update({ intensity: v ?? undefined })} />
              <SelectInput path={['flair']} label="On phones" value={f.phone} options={PHONE} onChange={(v) => update({ phone: v ?? undefined })} />
              <TextInput path={['flair']} label="Notes" multiline value={f.detail} onChange={(v) => update({ detail: v ?? undefined })} />
            </>
          )}
        </ItemList>
      </Section>

      <Section title="Motion">
        {S(['motion', 'level'], 'How much movement', MOTION)}
        {T(['motion', 'detail'], 'Notes', { multiline: true })}
      </Section>

      <Section title="Taken from references" hint="Each entry names one quality taken from a reference, never a look to copy. New entries come from the mood board.">
        <ItemList<NonNullable<DirectionBody['taken_from_references']>[number]>
          path={['taken_from_references']} items={body.taken_from_references} onChange={(v) => set(['taken_from_references'], v)}
          title={(r, i) => r.property || `Reference ${i + 1}`}
        >
          {(r, _i, update) => <TextInput path={['taken_from_references']} label="What is taken" value={r.property} onChange={(v) => update({ property: v ?? '' })} />}
        </ItemList>
      </Section>

      <Section title="Client requests" hint="How each thing the client asked for is honoured. New answers are added from the sign-off list below.">
        <ItemList<NonNullable<DirectionBody['client_requests']>[number]>
          path={['client_requests']} items={body.client_requests} onChange={(v) => set(['client_requests'], v)}
          title={(_r, i) => `Request ${i + 1}`}
        >
          {(r, _i, update) => (
            <>
              {quotes[r.design_note_id] && <blockquote className="border-l-2 border-border-warm pl-3 text-sm text-text-sub">{quotes[r.design_note_id]}</blockquote>}
              <TextInput path={['client_requests']} label="How this is honoured" multiline value={r.how_honoured} onChange={(v) => update({ how_honoured: v ?? '' })} />
            </>
          )}
        </ItemList>
      </Section>

      <Section title="Avoid">{L(['avoid'], 'Things to avoid')}</Section>
      <Section title="Open questions">{L(['open_questions'], 'Questions still open')}</Section>
    </div>
  );
}
