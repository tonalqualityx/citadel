import { describe, it, expect } from 'vitest';
import {
  MODE_TABS,
  DEFAULT_MODE,
  getModeTabs,
  isReturnToWorkVisible,
  resolveTabLabel,
  resolveTabTooltip,
} from '../mode-shell-logic';

describe('mode-shell-logic', () => {
  it('defaults to work mode', () => {
    expect(DEFAULT_MODE).toBe('work');
  });

  // Oracle Projects Tab (2026-09-04) — no more fixed 3-tab list ("no 4th Gate tab" build-
  // plan deviation still holds — Gate is a state, not a mode). The tab list is now a
  // function of flags: with the shipped defaults (Plan/Process hidden, Projects on) it's
  // ['work', 'projects']; with Plan/Process un-hidden it's the full 4.
  it('ships work + projects with the shipped defaults (Plan/Process hidden)', () => {
    expect(getModeTabs({ ORACLE_PROJECTS_TAB: true, ORACLE_HIDE_PLAN_PROCESS: true }).map((t) => t.mode)).toEqual([
      'work',
      'projects',
    ]);
  });

  it('ships all four tabs when Plan/Process are un-hidden', () => {
    expect(getModeTabs({ ORACLE_PROJECTS_TAB: true, ORACLE_HIDE_PLAN_PROCESS: false }).map((t) => t.mode)).toEqual([
      'work',
      'plan',
      'process',
      'projects',
    ]);
  });

  it('every tab carries a label, glyph, and tooltip', () => {
    for (const tab of MODE_TABS) {
      expect(tab.label).toBeTruthy();
      expect(tab.glyph).toBeTruthy();
      expect(tab.tooltip).toBeTruthy();
    }
  });

  it('Return to Work is hidden in Work and visible in every other mode', () => {
    expect(isReturnToWorkVisible('work')).toBe(false);
    expect(isReturnToWorkVisible('plan')).toBe(true);
    expect(isReturnToWorkVisible('process')).toBe(true);
  });

  // Spec polish (2026-09-04) — the Projects tab's label/tooltip route through
  // useTerminology so the tab and the Sidebar's own t('projects') nav item agree.
  describe('resolveTabLabel / resolveTabTooltip', () => {
    const awesomeT = (key: string) => (key === 'projects' ? 'Commissions' : key);
    const standardT = (key: string) => (key === 'projects' ? 'Projects' : key);
    const projectsTab = MODE_TABS.find((tab) => tab.mode === 'projects')!;
    const workTab = MODE_TABS.find((tab) => tab.mode === 'work')!;

    it('the Projects tab label follows t("projects") under the awesome convention', () => {
      expect(resolveTabLabel(projectsTab, awesomeT)).toBe('Commissions');
    });

    it('the Projects tab label follows t("projects") under the standard convention', () => {
      expect(resolveTabLabel(projectsTab, standardT)).toBe('Projects');
    });

    it('every other tab keeps its fixed English label, untouched by terminology', () => {
      expect(resolveTabLabel(workTab, awesomeT)).toBe(workTab.label);
    });

    it('the Projects tab tooltip embeds t("projects") too', () => {
      expect(resolveTabTooltip(projectsTab, awesomeT)).toContain('Commissions');
    });

    it('every other tab keeps its fixed tooltip, untouched by terminology', () => {
      expect(resolveTabTooltip(workTab, awesomeT)).toBe(workTab.tooltip);
    });
  });
});
