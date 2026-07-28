import { describe, it, expect } from 'vitest';
import { MODE_TABS, DEFAULT_MODE, isReturnToWorkVisible } from '../mode-shell-logic';

describe('mode-shell-logic', () => {
  it('defaults to work mode', () => {
    expect(DEFAULT_MODE).toBe('work');
  });

  it('ships exactly 3 tabs — no 4th "Gate" tab (build-plan deviation, orchestrator-approved)', () => {
    expect(MODE_TABS.map((t) => t.mode)).toEqual(['work', 'plan', 'process']);
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
});
