import { describe, it, expect } from 'vitest';
import { parseCatchInput } from '../oracle-header-logic';

describe('parseCatchInput', () => {
  it('returns null for blank input', () => {
    expect(parseCatchInput('   ')).toBeNull();
  });

  it('strips a "task:" prefix (case-insensitive) and files as a task', () => {
    expect(parseCatchInput('task: call the bookkeeper')).toEqual({
      kind: 'task',
      text: 'call the bookkeeper',
    });
    expect(parseCatchInput('TASK:call the bookkeeper')).toEqual({
      kind: 'task',
      text: 'call the bookkeeper',
    });
  });

  it('returns null for a bare "task:" prefix with nothing after it', () => {
    expect(parseCatchInput('task:   ')).toBeNull();
  });

  it('strips an optional "idea:" prefix and files as an idea', () => {
    expect(parseCatchInput('idea: microsite for deconstruction')).toEqual({
      kind: 'idea',
      text: 'microsite for deconstruction',
    });
  });

  it('defaults to idea when no recognized prefix is present', () => {
    expect(parseCatchInput('a stray thought')).toEqual({ kind: 'idea', text: 'a stray thought' });
  });
});
