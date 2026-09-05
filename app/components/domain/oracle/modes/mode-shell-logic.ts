import { ORACLE_PROJECTS_TAB, ORACLE_HIDE_PLAN_PROCESS } from '@/lib/config/feature-flags';
import type { TermKey } from '@/lib/hooks/use-terminology';

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
//
// Oracle Projects Tab (2026-09-04) — Projects joins as a 4th mode. It is NOT escorted the
// way Plan/Process are: it's a self-serve surface like Work (Mike explicitly wants to
// check it directly), so it always ships when ORACLE_PROJECTS_TAB is on, independent of
// the Plan/Process hide flag.
export type OracleMode = 'work' | 'plan' | 'process' | 'projects';

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
// ritual, which is either a dead click or a lie.
const WORK_TAB: ModeTabDef = {
  mode: 'work',
  label: 'Work',
  glyph: '◆',
  tooltip: 'Work — the one thing to pick, right now',
};
const PLAN_TAB: ModeTabDef = {
  mode: 'plan',
  label: 'Plan',
  glyph: '▦',
  tooltip: "Plan — the ritual's room: full board, ledger, pipeline, week",
};
const PROCESS_TAB: ModeTabDef = {
  mode: 'process',
  label: 'Process',
  glyph: '⚙',
  tooltip: 'Process — the batch: intake, reviews, admin',
};
const PROJECTS_TAB: ModeTabDef = {
  mode: 'projects',
  label: 'Projects',
  glyph: '◈',
  tooltip: 'Projects — in-progress contracted work, stalled-on-Mike first',
};

export interface ModeTabFlags {
  ORACLE_PROJECTS_TAB: boolean;
  ORACLE_HIDE_PLAN_PROCESS: boolean;
}

// Oracle Projects Tab (2026-09-04) — the tab list is now a function of feature flags
// rather than a fixed array: Plan/Process hide behind ORACLE_HIDE_PLAN_PROCESS, and
// Projects only ships when ORACLE_PROJECTS_TAB is on. Work is always present, always first.
export function getModeTabs(flags: ModeTabFlags): ModeTabDef[] {
  const tabs: ModeTabDef[] = [WORK_TAB];
  if (!flags.ORACLE_HIDE_PLAN_PROCESS) {
    tabs.push(PLAN_TAB, PROCESS_TAB);
  }
  if (flags.ORACLE_PROJECTS_TAB) {
    tabs.push(PROJECTS_TAB);
  }
  return tabs;
}

// Back-compat: existing call sites read MODE_TABS as a plain array reflecting the
// CURRENTLY CONFIGURED flags (lib/config/feature-flags.ts), not a fixed constant. New
// code should prefer getModeTabs(flags) directly (e.g. to pass explicit/mocked flags in
// tests) — this export exists so ModeTabs.tsx doesn't need an extra prop threaded through
// for the common "just read the real flags" case.
export const MODE_TABS: ModeTabDef[] = getModeTabs({ ORACLE_PROJECTS_TAB, ORACLE_HIDE_PLAN_PROCESS });

export function isReturnToWorkVisible(mode: OracleMode): boolean {
  return mode !== 'work';
}

// Spec polish (2026-09-04) — the Projects tab's label/tooltip route through
// useTerminology so the tab and the Sidebar's own t('projects') nav item never drift
// apart (awesome convention: "Commissions"; standard: "Projects"). Every other tab's
// label/tooltip is fixed English, untouched by terminology. Pure functions (t passed in)
// so this is unit-testable without rendering the hook.
export function resolveTabLabel(tab: ModeTabDef, t: (key: TermKey) => string): string {
  return tab.mode === 'projects' ? t('projects') : tab.label;
}

export function resolveTabTooltip(tab: ModeTabDef, t: (key: TermKey) => string): string {
  return tab.mode === 'projects'
    ? `${t('projects')} — in-progress contracted work, stalled-on-Mike first`
    : tab.tooltip;
}
