import { describe, it, expect } from 'vitest';
import { calculateEstimatedMinutes } from '@/lib/calculations/energy';
import { TRIAGE_DEFAULT_ESTIMATE_TAG, TRIAGE_PROJECT_SETUP_MINUTES, defaultCalculatedMinutes, estimatePatchForKind, type EstimateState } from '../triage-estimate';

const blank = (o: Partial<EstimateState> = {}): EstimateState => ({ estimated_minutes: null, energy_estimate: null, mystery_factor: 'none', battery_impact: 'average_drain', tags: [], ...o });
/** What every reader shows: a positive stored estimate first, else the formula on the inputs (lib/home/select.ts taskMinutes). */
const shown = (c: EstimateState) => (c.estimated_minutes && c.estimated_minutes > 0 ? c.estimated_minutes : calculateEstimatedMinutes(c.energy_estimate, c.mystery_factor as never, c.battery_impact as never));

describe('project setup card default estimate', () => {
  it('the constant is 60 and the inputs calculate to exactly it under the existing formula', () => {
    expect(TRIAGE_PROJECT_SETUP_MINUTES).toBe(60);
    expect(defaultCalculatedMinutes()).toBe(60);
  });

  it('null becomes 60 on becoming project_setup, stored and calculated alike', () => {
    const w = estimatePatchForKind(null, 'project_setup', blank())!;
    expect(w).toMatchObject({ estimated_minutes: 60, energy_estimate: 3, mystery_factor: 'none', battery_impact: 'energizing' });
    expect(w.tags).toContain(TRIAGE_DEFAULT_ESTIMATE_TAG);
    expect(shown({ ...blank(), ...w })).toBe(60);
    expect(calculateEstimatedMinutes(w.energy_estimate, w.mystery_factor as never, w.battery_impact as never)).toBe(60);
    expect(estimatePatchForKind('task', 'project_setup', blank())).not.toBeNull();
  });

  it('an existing estimate is kept (minutes, or an energy estimate)', () => {
    expect(estimatePatchForKind(null, 'project_setup', blank({ estimated_minutes: 106, energy_estimate: 4 }))).toBeNull();
    expect(estimatePatchForKind(null, 'project_setup', blank({ estimated_minutes: 27 }))).toBeNull();
    expect(estimatePatchForKind(null, 'project_setup', blank({ energy_estimate: 5 }))).toBeNull();
  });

  it('kind changed away clears a defaulted 60 (back to no estimate) but not a hand-set value', () => {
    const set = { ...blank(), ...estimatePatchForKind(null, 'project_setup', blank())! };
    const cleared = estimatePatchForKind('project_setup', 'task', set)!;
    expect(cleared).toMatchObject({ estimated_minutes: null, energy_estimate: null, mystery_factor: 'none', battery_impact: 'average_drain', tags: [] });
    expect(shown({ ...set, ...cleared })).toBeNull();
    // Mike changed the estimate after the default: it stays, only the marker goes
    const hand = { ...set, energy_estimate: 4, estimated_minutes: 132, battery_impact: 'high_drain' };
    expect(estimatePatchForKind('project_setup', 'task', hand)).toMatchObject({ estimated_minutes: 132, energy_estimate: 4, battery_impact: 'high_drain', tags: [] });
    // a 60 Mike set himself (no marker) is never touched
    expect(estimatePatchForKind('project_setup', 'task', blank({ estimated_minutes: 60, energy_estimate: 3 }))).toBeNull();
  });

  it('setting the kind to project_setup again does not stack the marker', () => {
    const set = { ...blank(), ...estimatePatchForKind(null, 'project_setup', blank())! };
    expect(estimatePatchForKind('project_setup', 'project_setup', set)).toBeNull();
  });
});
