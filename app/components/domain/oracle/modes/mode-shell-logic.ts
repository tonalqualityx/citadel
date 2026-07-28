// Clarity Phase 8 (composition) — the mode-escort law (Mike 07-27 final): "I never will
// click the other tabs. I'll stay in panicked 'I should be working on client stuff' from
// whatever is on the front page." Modes are ESCORTED, never navigated:
//   - Work is the only self-serve surface (and the default/landing mode, always).
//   - Plan is entered via a door click or the ritual conversation (walked WITH Bast).
//   - Process is entered via a door click or when the glass invites (a door's detail line),
//     never a toast, never a timer-based auto-switch.
// The tabs stay MOUNTED for "rare deliberate visits" but get NO visual pull (see ModeTabs) —
// they are a mode INDICATOR first, a navigation control a distant second.
//
// There is deliberately NO auto-switch helper anywhere in this module (or its consumers):
// no effect that watches counts/timers and flips the mode out from under Mike. The only
// three things that ever change the mode are a tab click, a door click, and "Return to Work".
export type OracleMode = 'work' | 'plan' | 'process';

export const DEFAULT_MODE: OracleMode = 'work';

export interface ModeTabDef {
  mode: OracleMode;
  label: string;
  glyph: string;
  tooltip: string;
}

// The wireframe's 4th "Gate" tab is NOT shipped (build-plan deviation, orchestrator-
// approved): the Gate is a STATE of the page (RitualGate's cover, on or off), not a mode
// to visit — a "Gate" tab clicked mid-afternoon would show a cover for an already-satisfied
// ritual, which is either a dead click or a lie. Only 3 real modes exist.
export const MODE_TABS: ModeTabDef[] = [
  { mode: 'work', label: 'Work', glyph: '◆', tooltip: 'Work — the one thing to pick, right now' },
  { mode: 'plan', label: 'Plan', glyph: '▦', tooltip: "Plan — the ritual's room: full board, ledger, pipeline, week" },
  { mode: 'process', label: 'Process', glyph: '⚙', tooltip: 'Process — the batch: intake, reviews, admin' },
];

export function isReturnToWorkVisible(mode: OracleMode): boolean {
  return mode !== 'work';
}
