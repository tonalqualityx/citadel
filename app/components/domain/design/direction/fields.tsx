'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';
import { keyOf, type Path } from './direction-model';

/** What the form shares with every field: read-only mode, focus tracking and the "Updated" marks. */
export interface FieldContextValue {
  readOnly: boolean;
  onFocus: (path: Path) => void;
  onBlur: (path: Path) => void;
  isUpdated: (path: Path) => boolean;
}

export const FieldContext = React.createContext<FieldContextValue>({
  readOnly: false,
  onFocus: () => {},
  onBlur: () => {},
  isUpdated: () => false,
});

const control =
  'block w-full rounded-lg border border-border-warm bg-surface px-3 py-2 text-sm text-text-main shadow-sm ' +
  'min-h-[44px] sm:min-h-[40px] placeholder:text-text-sub focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ' +
  'aria-[invalid=true]:border-red-600';

interface FieldShellProps {
  path: Path;
  label: string;
  hint?: string;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined }) => React.ReactNode;
  readValue?: React.ReactNode;
}

function FieldShell({ path, label, hint, error, children, readValue }: FieldShellProps) {
  const ctx = React.useContext(FieldContext);
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const updated = ctx.isUpdated(path);
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="min-w-0" data-field={keyOf(path)}>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        {ctx.readOnly ? (
          <span className="text-sm font-medium text-text-main">{label}</span>
        ) : (
          <label htmlFor={id} className="text-sm font-medium text-text-main">{label}</label>
        )}
        <span role="status" aria-live="polite" className="text-xs font-medium text-primary">{updated ? 'Updated' : ''}</span>
      </div>
      {ctx.readOnly ? (
        <div className="whitespace-pre-wrap break-words rounded-lg bg-background-light px-3 py-2 text-sm text-text-main">
          {readValue ?? <span className="text-text-sub">Not set</span>}
        </div>
      ) : (
        children({ id, describedBy })
      )}
      {hint && <p id={hintId} className="mt-1 text-xs text-text-sub">{hint}</p>}
      {error && <p id={errId} className="mt-1 text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** Local text while the designer types: the saved value flows in only when this field does not have focus. */
function useLocalText(value: string) {
  const [text, setText] = React.useState(value);
  const focused = React.useRef(false);
  const latest = React.useRef(value);
  React.useEffect(() => {
    latest.current = value;
    if (!focused.current) setText(value);
  }, [value]);
  return {
    text,
    setText,
    onFocus: () => { focused.current = true; },
    onBlur: (keep = false) => { focused.current = false; if (!keep) setText(latest.current); },
  };
}

export interface TextInputProps {
  path: Path;
  label: string;
  value: string | undefined;
  onChange: (v: string | null) => void;
  multiline?: boolean;
  hint?: string;
  maxLength?: number;
  error?: string | null;
}

export function TextInput({ path, label, value, onChange, multiline, hint, maxLength, error }: TextInputProps) {
  const ctx = React.useContext(FieldContext);
  const local = useLocalText(value ?? '');
  const props = (ids: { id: string; describedBy: string | undefined }) => ({
    id: ids.id,
    value: local.text,
    maxLength,
    'aria-describedby': ids.describedBy,
    'aria-invalid': error ? true : undefined,
    className: cn(control, multiline && 'min-h-[88px]'),
    onFocus: () => { local.onFocus(); ctx.onFocus(path); },
    onBlur: () => { ctx.onBlur(path); local.onBlur(); },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      local.setText(e.target.value);
      onChange(e.target.value.trim() === '' ? null : e.target.value);
    },
  });
  return (
    <FieldShell path={path} label={label} hint={hint} error={error} readValue={value ? value : undefined}>
      {(ids) => (multiline ? <textarea rows={3} {...props(ids)} /> : <input type="text" {...props(ids)} />)}
    </FieldShell>
  );
}

export interface NumberInputProps {
  path: Path;
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (v: number | null) => void;
  hint?: string;
  unit?: string;
}

export function NumberInput({ path, label, value, min, max, onChange, hint, unit = 'px' }: NumberInputProps) {
  const ctx = React.useContext(FieldContext);
  const local = useLocalText(value === undefined ? '' : String(value));
  const t = local.text.trim();
  const bad = t !== '' && (!/^\d+$/.test(t) || Number(t) < min || Number(t) > max);
  const error = bad ? `Use a whole number from ${min} to ${max}.` : null;
  return (
    <FieldShell path={path} label={`${label} (${unit})`} hint={hint} error={error} readValue={value !== undefined ? `${value} ${unit}` : undefined}>
      {(ids) => (
        <input
          type="text"
          inputMode="numeric"
          id={ids.id}
          value={local.text}
          aria-describedby={ids.describedBy}
          aria-invalid={bad ? true : undefined}
          className={control}
          onFocus={() => { local.onFocus(); ctx.onFocus(path); }}
          onBlur={() => { ctx.onBlur(path); local.onBlur(bad); }}
          onChange={(e) => {
            const raw = e.target.value;
            local.setText(raw);
            const s = raw.trim();
            if (s === '') onChange(null);
            else if (/^\d+$/.test(s) && Number(s) >= min && Number(s) <= max) onChange(Number(s));
          }}
        />
      )}
    </FieldShell>
  );
}

export interface SelectInputProps<T extends string | boolean> {
  path: Path;
  label: string;
  value: T | undefined;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T | null) => void;
  hint?: string;
}

export function SelectInput<T extends string | boolean>({ path, label, value, options, onChange, hint }: SelectInputProps<T>) {
  const ctx = React.useContext(FieldContext);
  const current = options.findIndex((o) => o.value === value);
  return (
    <FieldShell path={path} label={label} hint={hint} readValue={current >= 0 ? options[current].label : undefined}>
      {(ids) => (
        <select
          id={ids.id}
          value={current >= 0 ? String(current) : ''}
          aria-describedby={ids.describedBy}
          className={control}
          onFocus={() => ctx.onFocus(path)}
          onBlur={() => ctx.onBlur(path)}
          onChange={(e) => onChange(e.target.value === '' ? null : options[Number(e.target.value)].value)}
        >
          <option value="">Not set</option>
          {options.map((o, i) => <option key={String(o.value)} value={String(i)}>{o.label}</option>)}
        </select>
      )}
    </FieldShell>
  );
}

export const YES_NO = [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];

export interface LinesInputProps {
  path: Path;
  label: string;
  value: string[] | undefined;
  onChange: (v: string[] | null) => void;
  /** One entry per line (default) or separated by commas. */
  separator?: 'line' | 'comma';
  hint?: string;
}

export function LinesInput({ path, label, value, onChange, separator = 'line', hint }: LinesInputProps) {
  const ctx = React.useContext(FieldContext);
  const join = separator === 'line' ? '\n' : ', ';
  const local = useLocalText((value ?? []).join(join));
  const hintText = hint ?? (separator === 'line' ? 'One per line.' : 'Separate with commas.');
  const parse = (raw: string) => raw.split(separator === 'line' ? /\n/ : /,/).map((s) => s.trim()).filter(Boolean);
  const common = {
    value: local.text,
    className: control,
    onFocus: () => { local.onFocus(); ctx.onFocus(path); },
    onBlur: () => { ctx.onBlur(path); local.onBlur(); },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      local.setText(e.target.value);
      const items = parse(e.target.value);
      onChange(items.length ? items : null);
    },
  };
  return (
    <FieldShell path={path} label={label} hint={hintText} readValue={value && value.length ? value.join(separator === 'line' ? '\n' : ', ') : undefined}>
      {(ids) =>
        separator === 'line' ? (
          <textarea rows={3} id={ids.id} aria-describedby={ids.describedBy} {...common} />
        ) : (
          <input type="text" id={ids.id} aria-describedby={ids.describedBy} {...common} />
        )
      }
    </FieldShell>
  );
}
