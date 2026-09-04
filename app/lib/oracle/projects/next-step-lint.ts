// Oracle Projects Tab Phase 3 — the server-side lexical gate for next_step_text and
// email_summary written by the machine-side job (PUT /api/oracle/projects/[id]/next-step/write).
// This is a straight port of the four grep patterns in
// ~/.claude/skills/writing-standard/comment-gate.sh (§6b of the writing-standard skill's
// SKILL.md is the canonical law; that shell script is the enforcement floor for any
// comment a human reads). Pure module: no filesystem, no network, no clock.
//
// Only the four grep-based checks are ported — the shell script's word-count length cap
// is a separate, comment-scoped rule and doesn't apply here (next_step_text already has
// its own ~30-word/500-char shape enforced by the caller).
//
// Deliberately case-sensitive and un-normalized, matching comment-gate.sh's `grep -noP`
// (no `-i` flag there either) — a lowercase false negative here is the same false
// negative the shell gate would produce.

export interface LintViolation {
  rule: string;
  matches: string[];
}

interface LintRule {
  rule: string;
  pattern: RegExp;
}

const MAX_MATCHES_PER_RULE = 5; // mirrors comment-gate.sh's `head -5`

const RULES: LintRule[] = [
  {
    rule: 'pipeline/gate codes (B0-B8, W-steps, F/U/C legs): say what the step MEANS',
    pattern: /\b[BW][0-9](\.[0-9])?\b|\bF\/U\/C\b|\b(gate|step|phase|leg) [A-Z][0-9]?\b/g,
  },
  {
    rule: 'worker-internal vocabulary the reader cannot decode',
    pattern:
      /\b(the Stone|Seeing Stone|fingerprint|reconcile|spawn|tick|pass [0-9]+|no_task|wake card|cockpit|capability gate|stale-claim|orphan stash|ledger row)\b/g,
  },
  {
    rule: 'process narration (what you ran), not what the reader needs',
    pattern: /\b(ran W|W[0-9] (found|had|checked)|census|re-derived|probes? (came back|negative))\b/g,
  },
  {
    rule: 'em/en dash or dash entity (dash law)',
    // comment-gate.sh matches \x{2014} (em dash), \x{2013} (en dash), the HTML/numeric
    // entities for both, and a spaced double-hyphen ' -- '.
    pattern: /—|–|&mdash;|&ndash;|&#8212;|&#8211;| -- /g,
  },
];

/**
 * Lints a single piece of reader-facing text (next_step_text or email_summary) against
 * the four comment-gate.sh grep patterns. Returns one violation per rule that matched,
 * each carrying up to 5 example matches (comment-gate.sh's `head -5`). Empty array = clean.
 */
export function lintNextStepText(text: string): LintViolation[] {
  const violations: LintViolation[] = [];
  for (const { rule, pattern } of RULES) {
    const matches = Array.from(text.matchAll(pattern), (m) => m[0]).slice(0, MAX_MATCHES_PER_RULE);
    if (matches.length > 0) {
      violations.push({ rule, matches });
    }
  }
  return violations;
}

/**
 * Lints next_step_text and (if present) email_summary together. Returns a flat list of
 * violations, each tagged with which field it came from, for the write route's 422 body.
 */
export function lintNextStepFields(
  fields: { next_step_text: string; email_summary?: string | null }
): Array<LintViolation & { field: 'next_step_text' | 'email_summary' }> {
  const out: Array<LintViolation & { field: 'next_step_text' | 'email_summary' }> = [];
  for (const v of lintNextStepText(fields.next_step_text)) {
    out.push({ ...v, field: 'next_step_text' });
  }
  if (fields.email_summary) {
    for (const v of lintNextStepText(fields.email_summary)) {
      out.push({ ...v, field: 'email_summary' });
    }
  }
  return out;
}
