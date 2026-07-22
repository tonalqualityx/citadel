import { describe, it, expect } from 'vitest';
import { columnForPick, fieldsForTransition } from '../today-board-logic';

function pick(overrides: { started_at?: string | null; completed_at?: string | null } = {}) {
  return { started_at: null, completed_at: null, ...overrides };
}

const NOW = '2026-07-22T12:00:00.000Z';
const now = () => NOW;

describe('columnForPick', () => {
  it('is "todo" when neither started_at nor completed_at is set', () => {
    expect(columnForPick(pick())).toBe('todo');
  });

  it('is "doing" when started_at is set and completed_at is null', () => {
    expect(columnForPick(pick({ started_at: '2026-07-22T10:00:00.000Z' }))).toBe('doing');
  });

  it('is "done" when completed_at is set, regardless of started_at', () => {
    expect(columnForPick(pick({ completed_at: '2026-07-22T11:00:00.000Z' }))).toBe('done');
    expect(
      columnForPick(pick({ started_at: '2026-07-22T09:00:00.000Z', completed_at: '2026-07-22T11:00:00.000Z' }))
    ).toBe('done');
  });

  it('"done" wins even without ever having been started (direct To do -> Done)', () => {
    expect(columnForPick(pick({ started_at: null, completed_at: '2026-07-22T11:00:00.000Z' }))).toBe('done');
  });
});

describe('fieldsForTransition', () => {
  it('returns null for a same-column drop (no-op)', () => {
    expect(fieldsForTransition('todo', 'todo', now)).toBeNull();
    expect(fieldsForTransition('doing', 'doing', now)).toBeNull();
    expect(fieldsForTransition('done', 'done', now)).toBeNull();
  });

  it('drag to Doing sets started_at', () => {
    expect(fieldsForTransition('todo', 'doing', now)).toEqual({ started_at: NOW });
  });

  it('drag back (Doing -> To do) clears started_at', () => {
    expect(fieldsForTransition('doing', 'todo', now)).toEqual({ started_at: null });
  });

  it('drag to Done sets completed_at, from To do', () => {
    expect(fieldsForTransition('todo', 'done', now)).toEqual({ completed_at: NOW });
  });

  it('drag to Done sets completed_at, from Doing', () => {
    expect(fieldsForTransition('doing', 'done', now)).toEqual({ completed_at: NOW });
  });

  it('drag out of Done to Doing clears completed_at but preserves started_at (does not set it)', () => {
    const fields = fieldsForTransition('done', 'doing', now);
    expect(fields).toEqual({ completed_at: null });
    expect(fields).not.toHaveProperty('started_at');
  });

  it('drag out of Done to To do clears completed_at but preserves started_at (does not clear it)', () => {
    const fields = fieldsForTransition('done', 'todo', now);
    expect(fields).toEqual({ completed_at: null });
    expect(fields).not.toHaveProperty('started_at');
  });
});
