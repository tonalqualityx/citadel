'use client';

import { cn } from '@/lib/utils/cn';

export type ViewportKey = '390' | '768' | '1280' | '1440' | '1680' | 'fit';

export const VIEWPORTS: ReadonlyArray<{ key: ViewportKey; label: string; width: number | null }> = [
  { key: '390', label: '390', width: 390 },
  { key: '768', label: '768', width: 768 },
  { key: '1280', label: '1280', width: 1280 },
  { key: '1440', label: '1440', width: 1440 },
  { key: '1680', label: '1680', width: 1680 },
  { key: 'fit', label: 'Fit', width: null },
];

/** CSS width for the iframe wrapper: a fixed px width, or the whole pane for "fit". */
export function viewportWidth(key: ViewportKey): string {
  const v = VIEWPORTS.find((x) => x.key === key);
  return v?.width ? `${v.width}px` : '100%';
}

export function ViewportSwitcher({ value, onChange }: { value: ViewportKey; onChange: (key: ViewportKey) => void }) {
  return (
    <div role="group" aria-label="Preview width" className="inline-flex max-w-full overflow-x-auto rounded-md border border-border-warm bg-surface p-0.5">
      {VIEWPORTS.map((v) => (
        <button
          key={v.key}
          type="button"
          aria-pressed={value === v.key}
          onClick={() => onChange(v.key)}
          className={cn(
            'min-h-[44px] shrink-0 rounded-sm px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:min-h-8',
            value === v.key ? 'bg-primary text-white' : 'text-text-sub hover:bg-background-light hover:text-text-main',
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
