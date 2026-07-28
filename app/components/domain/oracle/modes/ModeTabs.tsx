'use client';

import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { MODE_TABS, isReturnToWorkVisible, type OracleMode } from './mode-shell-logic';

interface ModeTabsProps {
  mode: OracleMode;
  onChange: (mode: OracleMode) => void;
}

// Clarity Phase 8 (composition) — the mode-escort law's wireframe AMENDMENT (orchestrator-
// ordered): the approved wireframe styled the active tab with a filled background + accent
// color + border, which is exactly the kind of visual pull the escort law forbids ("tabs
// remain for rare deliberate visits but get NO visual pull"). Shipped instead: text-only,
// one weight step brighter + `aria-current` for the active tab — never a background, never
// a border, never accent color on the tabs themselves. `Return to Work` is the one
// exception that KEEPS a bordered, pulling treatment — it's the escape hatch and should
// pull the eye.
export function ModeTabs({ mode, onChange }: ModeTabsProps) {
  return (
    <nav className="flex items-center gap-2" aria-label="Seeing Stone modes" data-testid="mode-tabs">
      {MODE_TABS.map((tab, i) => {
        const active = tab.mode === mode;
        return (
          <div key={tab.mode} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true" className="text-text-muted/50">·</span>}
            <Tooltip content={tab.tooltip}>
              <button
                type="button"
                onClick={() => onChange(tab.mode)}
                aria-current={active ? 'page' : undefined}
                data-testid={`mode-tab-${tab.mode}`}
                className={cn(
                  'flex items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-colors',
                  'hover:text-text-main focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-warm',
                  active ? 'font-semibold text-text-main' : 'text-text-sub'
                )}
              >
                <span className="text-[0.7rem] text-text-sub" aria-hidden="true">{tab.glyph}</span>
                {tab.label}
              </button>
            </Tooltip>
          </div>
        );
      })}
    </nav>
  );
}

interface ReturnToWorkProps {
  mode: OracleMode;
  onClick: () => void;
}

export function ReturnToWork({ mode, onClick }: ReturnToWorkProps) {
  if (!isReturnToWorkVisible(mode)) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="return-to-work"
      className="rounded-md border border-border-warm px-3 py-1.5 text-xs text-text-sub hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
    >
      ← Return to Work
    </button>
  );
}
