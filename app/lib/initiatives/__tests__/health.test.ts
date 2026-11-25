import { describe, it, expect } from 'vitest';
import { MAX_ACTIVE, MAX_NUMBERS, computeInitiativeHealth, expectedValue, numberPace, type HealthNumber } from '../health';

const NOW = new Date('2026-06-15T00:00:00Z');
const d = (s: string) => new Date(s);

// Baseline June 1, target June 29: on June 15 it is exactly half way (14 of 28 days).
function number(overrides: Partial<HealthNumber> = {}): HealthNumber {
  return {
    label: 'Quotes sent',
    direction: 'up',
    baseline_value: 0,
    baseline_at: d('2026-06-01T00:00:00Z'),
    target_value: 10,
    target_by: d('2026-06-29T00:00:00Z'),
    last_value: null,
    last_read_at: null,
    ...overrides,
  };
}

const read = (value: number, at = '2026-06-14T00:00:00Z') => ({ last_value: value, last_read_at: d(at) });

describe('caps', () => {
  it('five active, three numbers', () => {
    expect(MAX_ACTIVE).toBe(5);
    expect(MAX_NUMBERS).toBe(3);
  });
});

describe('expectedValue', () => {
  it('is linear from baseline to target_by', () => {
    expect(expectedValue(number(), NOW)).toBe(5);
  });
  it('is clamped at the target after target_by and at the baseline before it', () => {
    expect(expectedValue(number(), d('2026-08-01T00:00:00Z'))).toBe(10);
    expect(expectedValue(number(), d('2026-05-01T00:00:00Z'))).toBe(0);
  });
});

describe('numberPace', () => {
  it('has no pace without a reading after the baseline', () => {
    expect(numberPace(number(), NOW).pace).toBe('no_pace');
    // a first reading that became the baseline is not a reading after it
    const at = d('2026-06-01T00:00:00Z');
    expect(numberPace(number({ last_value: 0, last_read_at: at }), NOW).pace).toBe('no_pace');
  });
  it('is on pace at or past expected going up', () => {
    expect(numberPace(number(read(5)), NOW).pace).toBe('on_pace');
    expect(numberPace(number(read(7)), NOW).pace).toBe('on_pace');
  });
  it('is behind below expected going up', () => {
    expect(numberPace(number(read(2)), NOW)).toEqual({ pace: 'behind', expected: 5 });
  });
  it('is met at the target, going up and going down', () => {
    expect(numberPace(number(read(10)), NOW).pace).toBe('met');
    expect(numberPace(number({ direction: 'down', baseline_value: 100, target_value: 20, ...read(15) }), NOW).pace).toBe('met');
  });
  it('goes down: at or under expected is on pace, over it is behind', () => {
    const down = { direction: 'down', baseline_value: 100, target_value: 0 };
    expect(numberPace(number({ ...down, ...read(50) }), NOW).pace).toBe('on_pace');
    expect(numberPace(number({ ...down, ...read(80) }), NOW).pace).toBe('behind');
  });
});

describe('computeInitiativeHealth', () => {
  const base = { check_date: d('2026-06-30T00:00:00Z'), latest_check_in: null, now: NOW };

  it('a fresh initiative is unchecked, neutral, and says the first reading is due', () => {
    const r = computeInitiativeHealth({ ...base, numbers: [number()] });
    expect(r.health).toBe('unchecked');
    expect(r.health_reason).toContain('First reading due 2026-06-30');
  });

  it('is on_track when every number with a reading is on pace or met', () => {
    const r = computeInitiativeHealth({ ...base, numbers: [number(read(6)), number({ label: 'Done one', ...read(10) })] });
    expect(r.health).toBe('on_track');
    expect(r.health_reason).toContain('Quotes sent is on pace');
  });

  it('is behind when any number is behind, and names it with the pace', () => {
    const r = computeInitiativeHealth({ ...base, numbers: [number(read(6)), number({ label: 'Calls booked', ...read(1) })] });
    expect(r.health).toBe('behind');
    expect(r.health_reason).toBe('Calls booked is behind pace: 1 of 5 expected by now');
  });

  it('a number with no reading does not decide health', () => {
    const r = computeInitiativeHealth({ ...base, numbers: [number(read(6)), number({ label: 'Not read yet' })] });
    expect(r.health).toBe('on_track');
  });

  it('met alone reads as on_track with the target in the reason', () => {
    const r = computeInitiativeHealth({ ...base, numbers: [number(read(10))] });
    expect(r.health).toBe('on_track');
    expect(r.health_reason).toContain('reached its target of 10');
  });

  it('a check-in newer than the newest reading wins, with its note', () => {
    const r = computeInitiativeHealth({
      ...base,
      numbers: [number(read(1, '2026-06-10T00:00:00Z'))],
      latest_check_in: { health: 'on_track', note: 'Two big quotes out', created_at: d('2026-06-12T00:00:00Z') },
    });
    expect(r.health).toBe('on_track');
    expect(r.health_reason).toContain('Two big quotes out');
  });

  it('a reading newer than the check-in takes over again', () => {
    const r = computeInitiativeHealth({
      ...base,
      numbers: [number(read(1, '2026-06-14T00:00:00Z'))],
      latest_check_in: { health: 'on_track', created_at: d('2026-06-12T00:00:00Z') },
    });
    expect(r.health).toBe('behind');
  });

  it('a check-in stops winning once the check date has passed with nothing newer', () => {
    const r = computeInitiativeHealth({
      check_date: d('2026-06-10T00:00:00Z'),
      numbers: [number(read(6, '2026-06-05T00:00:00Z'))],
      latest_check_in: { health: 'on_track', created_at: d('2026-06-08T00:00:00Z') },
      now: NOW,
    });
    expect(r.health).toBe('unchecked');
    expect(r.health_reason).toContain('2026-06-10');
  });

  it('is unchecked when the check date passed with no reading or check-in since', () => {
    const r = computeInitiativeHealth({
      check_date: d('2026-06-10T00:00:00Z'),
      numbers: [number(read(1, '2026-06-05T00:00:00Z'))],
      latest_check_in: null,
      now: NOW,
    });
    expect(r.health).toBe('unchecked');
  });

  it('a reading on or after the check date clears the unchecked state', () => {
    const r = computeInitiativeHealth({
      check_date: d('2026-06-10T00:00:00Z'),
      numbers: [number(read(6, '2026-06-12T00:00:00Z'))],
      latest_check_in: null,
      now: NOW,
    });
    expect(r.health).toBe('on_track');
  });

  it('keeps the reason within 200 characters', () => {
    const r = computeInitiativeHealth({ ...base, numbers: [number({ label: 'x'.repeat(120), ...read(1) })] });
    expect(r.health_reason.length).toBeLessThanOrEqual(200);
  });
});
