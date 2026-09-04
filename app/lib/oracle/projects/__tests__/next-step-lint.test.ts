import { describe, it, expect } from 'vitest';
import { lintNextStepText, lintNextStepFields } from '../next-step-lint';

describe('lintNextStepText', () => {
  it('returns no violations for clean, plain text', () => {
    expect(lintNextStepText('Mike needs to approve the homepage copy before Friday.')).toEqual([]);
  });

  it('flags a pipeline/gate code', () => {
    const violations = lintNextStepText('Waiting on B6 to clear before this can ship.');
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toMatch(/pipeline\/gate codes/);
    expect(violations[0].matches).toContain('B6');
  });

  it('flags an F/U/C leg reference', () => {
    const violations = lintNextStepText('This is on the F/U/C leg right now.');
    expect(violations.some((v) => v.rule.includes('pipeline/gate codes'))).toBe(true);
  });

  it('flags a "gate X" / "step X" phrase', () => {
    const violations = lintNextStepText('Blocked on gate B3 until reviewed.');
    expect(violations.some((v) => v.rule.includes('pipeline/gate codes'))).toBe(true);
  });

  it('flags worker-internal vocabulary', () => {
    const violations = lintNextStepText('Bast needs to reconcile the wake card before Mike sees it.');
    const rule = violations.find((v) => v.rule.includes('worker-internal vocabulary'));
    expect(rule).toBeTruthy();
    expect(rule?.matches).toContain('reconcile');
  });

  it('flags process narration', () => {
    const violations = lintNextStepText('Ran W3 and the probes came back negative.');
    expect(violations.some((v) => v.rule.includes('process narration'))).toBe(true);
  });

  it('flags an em dash', () => {
    const violations = lintNextStepText('Mike needs to sign off — the copy is ready.');
    const rule = violations.find((v) => v.rule.includes('dash law'));
    expect(rule).toBeTruthy();
    expect(rule?.matches[0]).toBe('—');
  });

  it('flags an en dash', () => {
    const violations = lintNextStepText('Due 9–12 this week.');
    expect(violations.some((v) => v.rule.includes('dash law'))).toBe(true);
  });

  it('flags an em-dash HTML entity', () => {
    const violations = lintNextStepText('Mike needs to sign off &mdash; the copy is ready.');
    expect(violations.some((v) => v.rule.includes('dash law'))).toBe(true);
  });

  it('flags a spaced double-hyphen', () => {
    const violations = lintNextStepText('Mike needs to sign off -- the copy is ready.');
    expect(violations.some((v) => v.rule.includes('dash law'))).toBe(true);
  });

  it('caps examples at 5 per rule', () => {
    const text = 'B1 B2 B3 B4 B5 B6 B7 all waiting.';
    const violations = lintNextStepText(text);
    const rule = violations.find((v) => v.rule.includes('pipeline/gate codes'));
    expect(rule?.matches.length).toBeLessThanOrEqual(5);
  });

  it('can flag more than one rule at once', () => {
    const violations = lintNextStepText('re-derived the plan, reconcile the wake card — B6 next.');
    const rules = violations.map((v) => v.rule);
    expect(rules.some((r) => r.includes('process narration'))).toBe(true);
    expect(rules.some((r) => r.includes('worker-internal vocabulary'))).toBe(true);
    expect(rules.some((r) => r.includes('dash law'))).toBe(true);
  });
});

describe('lintNextStepFields', () => {
  it('lints next_step_text only when email_summary is absent', () => {
    const violations = lintNextStepFields({ next_step_text: 'Clean text for Mike.' });
    expect(violations).toEqual([]);
  });

  it('tags violations with their source field', () => {
    const violations = lintNextStepFields({
      next_step_text: 'Waiting on B6.',
      email_summary: 'Client replied — approved.',
    });
    expect(violations.find((v) => v.field === 'next_step_text')).toBeTruthy();
    expect(violations.find((v) => v.field === 'email_summary')).toBeTruthy();
  });

  it('skips linting a null or undefined email_summary', () => {
    const violations = lintNextStepFields({ next_step_text: 'Clean text.', email_summary: null });
    expect(violations).toEqual([]);
  });
});
