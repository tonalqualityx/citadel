import { describe, it, expect } from 'vitest';
import {
  validateTodayPickRef,
  isAtWipCap,
  isPastWarningThreshold,
  primaryActionKindForPick,
  TODAY_PICK_WIP_CAP,
  TODAY_PICK_WARNING_THRESHOLD,
} from '../today-picks';

describe('validateTodayPickRef', () => {
  it('accepts an arc pick with only arc_id', () => {
    expect(validateTodayPickRef({ item_type: 'arc', arc_id: 'a1' })).toEqual({ valid: true });
  });

  it('accepts a task pick with only task_id', () => {
    expect(validateTodayPickRef({ item_type: 'task', task_id: 't1' })).toEqual({ valid: true });
  });

  it('accepts a session pick with only session_external_id', () => {
    expect(
      validateTodayPickRef({ item_type: 'session', session_external_id: 'sess-1' })
    ).toEqual({ valid: true });
  });

  it('accepts a lead pick with only charter_id', () => {
    expect(validateTodayPickRef({ item_type: 'lead', charter_id: 'c1' })).toEqual({ valid: true });
  });

  it('accepts a note pick with only a label', () => {
    expect(validateTodayPickRef({ item_type: 'note', label: 'Call the bank' })).toEqual({
      valid: true,
    });
  });

  it('allows a label alongside a ref as an override, still valid', () => {
    expect(
      validateTodayPickRef({ item_type: 'arc', arc_id: 'a1', label: 'Custom title' })
    ).toEqual({ valid: true });
  });

  it('rejects an arc pick missing arc_id', () => {
    const result = validateTodayPickRef({ item_type: 'arc' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/arc_id/);
  });

  it('rejects a task pick missing task_id', () => {
    const result = validateTodayPickRef({ item_type: 'task' });
    expect(result.valid).toBe(false);
  });

  it('rejects a session pick missing session_external_id', () => {
    const result = validateTodayPickRef({ item_type: 'session' });
    expect(result.valid).toBe(false);
  });

  it('rejects a lead pick missing charter_id', () => {
    const result = validateTodayPickRef({ item_type: 'lead' });
    expect(result.valid).toBe(false);
  });

  it('rejects a note pick with an empty label', () => {
    const result = validateTodayPickRef({ item_type: 'note', label: '' });
    expect(result.valid).toBe(false);
  });

  it('rejects a note pick missing a label entirely', () => {
    const result = validateTodayPickRef({ item_type: 'note' });
    expect(result.valid).toBe(false);
  });

  it('rejects a note pick that also carries a ref', () => {
    const result = validateTodayPickRef({ item_type: 'note', label: 'x', arc_id: 'a1' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/note picks may not carry/);
  });

  it('rejects an arc pick that also carries a second ref (task_id)', () => {
    const result = validateTodayPickRef({ item_type: 'arc', arc_id: 'a1', task_id: 't1' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/may only set arc_id/);
  });

  it('rejects a task pick that also carries session_external_id', () => {
    const result = validateTodayPickRef({
      item_type: 'task',
      task_id: 't1',
      session_external_id: 'sess-1',
    });
    expect(result.valid).toBe(false);
  });

  it('rejects an unknown item_type', () => {
    const result = validateTodayPickRef({ item_type: 'bogus' as never });
    expect(result.valid).toBe(false);
  });
});

describe('isAtWipCap', () => {
  it('is false below the cap', () => {
    expect(isAtWipCap(0)).toBe(false);
    expect(isAtWipCap(TODAY_PICK_WIP_CAP - 1)).toBe(false);
  });

  it('is true at and above the cap (a 6th pick is rejected)', () => {
    expect(isAtWipCap(TODAY_PICK_WIP_CAP)).toBe(true);
    expect(isAtWipCap(TODAY_PICK_WIP_CAP + 1)).toBe(true);
  });
});

describe('isPastWarningThreshold', () => {
  it('is false at and below the threshold', () => {
    expect(isPastWarningThreshold(0)).toBe(false);
    expect(isPastWarningThreshold(TODAY_PICK_WARNING_THRESHOLD)).toBe(false);
  });

  it('is true past the threshold', () => {
    expect(isPastWarningThreshold(TODAY_PICK_WARNING_THRESHOLD + 1)).toBe(true);
  });
});

describe('primaryActionKindForPick', () => {
  it('session with a remote_url -> respond', () => {
    expect(primaryActionKindForPick('session', { hasRemoteUrl: true })).toBe('respond');
  });

  it('session without a remote_url -> resume', () => {
    expect(primaryActionKindForPick('session', { hasRemoteUrl: false })).toBe('resume');
    expect(primaryActionKindForPick('session')).toBe('resume');
  });

  it('arc -> arc', () => {
    expect(primaryActionKindForPick('arc')).toBe('arc');
  });

  it('task -> quest', () => {
    expect(primaryActionKindForPick('task')).toBe('quest');
  });

  it('lead -> charter', () => {
    expect(primaryActionKindForPick('lead')).toBe('charter');
  });

  it('note -> toggle', () => {
    expect(primaryActionKindForPick('note')).toBe('toggle');
  });
});
