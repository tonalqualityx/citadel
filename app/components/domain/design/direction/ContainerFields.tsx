'use client';

import type { DirectionBody } from '@/lib/hooks/use-design-direction';
import { NumberInput, SelectInput, TextInput, LinesInput } from './fields';

export type ContainerValue = NonNullable<DirectionBody['container']>;

export interface ContainerFieldsProps {
  value: ContainerValue | undefined;
  /** `path` is relative to the container, for example `['max_content_px']` or `['gutters_px', 'phone']`. `null` clears the field. */
  onChange: (path: string[], value: number | string | string[] | null) => void;
}

const BASE = ['container'];

/** Page width: how wide the content runs and how the edges behave (SPEC 4.4, `container`). */
export function ContainerFields({ value, onChange }: ContainerFieldsProps) {
  const v = value ?? {};
  const p = (...rest: string[]) => [...BASE, ...rest];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <NumberInput path={p('max_content_px')} label="Widest the content gets" min={320} max={3840} value={v.max_content_px} onChange={(n) => onChange(['max_content_px'], n)} hint="Needed before sign-off." />
      <SelectInput
        path={p('method')}
        label="How the width is held"
        value={v.method}
        options={[
          { value: 'padding_cap', label: 'Padding on the sides (backgrounds still run edge to edge)' },
          { value: 'max_width', label: 'A maximum width on the content' },
        ]}
        onChange={(s) => onChange(['method'], s)}
      />
      <NumberInput path={p('wide_px')} label="Widest for wide sections" min={320} max={3840} value={v.wide_px} onChange={(n) => onChange(['wide_px'], n)} />
      <NumberInput path={p('measure_px')} label="Longest line of reading text" min={200} max={1400} value={v.measure_px} onChange={(n) => onChange(['measure_px'], n)} />
      <NumberInput path={p('gutters_px', 'phone')} label="Side space on phones" min={0} max={200} value={v.gutters_px?.phone} onChange={(n) => onChange(['gutters_px', 'phone'], n)} />
      <NumberInput path={p('gutters_px', 'tablet')} label="Side space on tablets" min={0} max={200} value={v.gutters_px?.tablet} onChange={(n) => onChange(['gutters_px', 'tablet'], n)} />
      <NumberInput path={p('gutters_px', 'desktop')} label="Side space on desktop" min={0} max={200} value={v.gutters_px?.desktop} onChange={(n) => onChange(['gutters_px', 'desktop'], n)} />
      <LinesInput path={p('full_bleed')} label="Sections that run edge to edge" separator="comma" value={v.full_bleed} onChange={(l) => onChange(['full_bleed'], l)} hint="For example: hero, footer. Separate with commas." />
      <div className="sm:col-span-2">
        <TextInput path={p('why')} label="Notes" multiline value={v.why} onChange={(s) => onChange(['why'], s)} />
      </div>
    </div>
  );
}
