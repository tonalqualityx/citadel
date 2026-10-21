import { describe, it, expect } from 'vitest';
import {
  WAIT_TEMPLATES,
  buildNextStepData,
  buildWaitData,
  getTemplate,
  guardPasses,
  liveTemplateKeys,
  renderTitle,
  TemplateError,
} from './templates';
import { zonedTimeToUtc } from './business-days';

describe('template table', () => {
  it('registers the 29 clocks from the spec plus the generic handoff', () => {
    const keys = WAIT_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k !== 'handoff.generic')).toHaveLength(29);
  });

  it('opens only the six phase 1 templates', () => {
    expect(liveTemplateKeys().sort()).toEqual(
      ['build.gate_mike', 'build.review_internal', 'change.needs_human', 'handoff.generic', 'meeting.type_unclear', 'switch.off'].sort()
    );
  });

  it('never enables a template that sends', () => {
    for (const t of WAIT_TEMPLATES) {
      if (t.enabled) expect(t.sends).toBe(false);
      const anySendStep = t.steps.some((s) => s.action === 'send');
      expect(t.sends).toBe(anySendStep);
    }
  });

  it('puts every sender behind a switch', () => {
    for (const t of WAIT_TEMPLATES.filter((x) => x.sends)) expect(t.switch_key).toBeTruthy();
  });

  it('writes standalone titles with a subject slot or none', () => {
    for (const t of WAIT_TEMPLATES) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.title).not.toMatch(/\bthis\b|\bit\b/i);
    }
  });

  it('matches the spec clocks', () => {
    const t = (k: string) => getTemplate(k)!;
    expect(t('sales.proposal_review').steps[0].duration).toEqual({ value: 2, unit: 'business_days' });
    expect(t('sales.audit_unopened').steps[0].duration).toEqual({ value: 48, unit: 'hours' });
    expect(t('sales.proposal_no_action').steps.map((s) => s.duration.value)).toEqual([5, 5]);
    expect(t('sales.proposal_dormant').steps[0].duration).toEqual({ value: 30, unit: 'business_days' });
    expect(t('launch.d90').steps[0].duration).toEqual({ value: 90, unit: 'calendar_days' });
    expect(t('launch.d90').precondition).toBe('no_charter');
    expect(t('build.review_client').steps[0].duration.value).toBe(10);
    // money.invoice marks: 30, 45, 60, 85, 90 days from the invoice
    const total = t('money.invoice').steps.reduce((n, s) => n + s.duration.value, 0);
    expect(t('money.invoice').steps.map((s) => s.duration.value)).toEqual([30, 15, 15, 25, 5]);
    expect(total).toBe(90);
    // change.staged_live: nudge at 5 bd, decision at 10 bd
    expect(t('change.staged_live').steps.map((s) => s.duration.value)).toEqual([5, 5]);
  });

  it('blocks a client only where the spec says yes', () => {
    const yes = WAIT_TEMPLATES.filter((t) => t.blocks_client).map((t) => t.key).sort();
    expect(yes).toEqual(['build.gate_mike', 'build.review_internal', 'change.needs_human', 'sales.proposal_review']);
  });
});

describe('guards', () => {
  it('defaults: silence accepts pre-launch reviews, never live changes', () => {
    expect(guardPasses('review_clock_on')).toBe(true);
    expect(guardPasses('silent_acceptance_live')).toBe(false);
  });
  it('a per-client value wins', () => {
    expect(guardPasses('review_clock_on', { review_clock_on: false })).toBe(false);
    expect(guardPasses('silent_acceptance_live', { silent_acceptance_live: true })).toBe(true);
    expect(guardPasses('review_clock_on', { review_clock_on: null })).toBe(true);
  });
});

describe('buildWaitData', () => {
  const start = zonedTimeToUtc(2026, 10, 21, 10);

  it('builds a live template with a business-day due time', () => {
    const d = buildWaitData({ template_key: 'build.gate_mike', subject: 'the VCDP sitemap', started_at: start, client_id: 'c1' });
    expect(d.title).toBe('Approve the VCDP sitemap');
    expect(d.due_at.toISOString()).toBe(zonedTimeToUtc(2026, 10, 23, 17).toISOString());
    expect(d.blocks_client).toBe(true);
    expect(d.client_waiting_since).toEqual(start);
    expect(d.terminal_action).toBe('escalate');
    expect((d.action_payload as Record<string, unknown>).owner_role).toBe('mike');
  });

  it('refuses a disabled template', () => {
    expect(() => buildWaitData({ template_key: 'sales.proposal_unopened', subject: 'x' })).toThrow(TemplateError);
    try {
      buildWaitData({ template_key: 'sales.proposal_unopened', subject: 'x' });
    } catch (e) {
      expect((e as TemplateError).code).toBe('template_disabled');
    }
  });

  it('refuses unknown templates and empty titles', () => {
    expect(() => buildWaitData({ template_key: 'nope' })).toThrow(/Unknown/);
    expect(() => buildWaitData({ template_key: 'handoff.generic' })).toThrow(/title or a subject/);
  });

  it('lets the generic handoff set its own duration, and no other template', () => {
    const g = buildWaitData({ template_key: 'handoff.generic', subject: 'Call Dan', started_at: start, duration: { value: 3, unit: 'calendar_days' } });
    expect(g.duration_unit).toBe('calendar_days');
    const s = buildWaitData({ template_key: 'build.gate_mike', subject: 'x', started_at: start, duration: { value: 9, unit: 'calendar_days' } });
    expect(s.duration_unit).toBe('business_days');
    expect(s.duration_value).toBe(2);
  });

  it('requires due_at for date-driven templates when allowed through', () => {
    expect(() => buildWaitData({ template_key: 'charter.renewal', subject: 'x' }, { allowDisabled: true })).toThrow(/due_at/);
    const due = new Date('2026-12-01T00:00:00Z');
    expect(buildWaitData({ template_key: 'charter.renewal', subject: 'x', due_at: due }, { allowDisabled: true }).due_at).toEqual(due);
  });

  it('carries the idempotency key and the subject', () => {
    const d = buildWaitData({ template_key: 'build.review_internal', subject: 'the home page copy', idempotency_key: 'k1' });
    expect(d.idempotency_key).toBe('k1');
    expect((d.action_payload as Record<string, unknown>).subject).toBe('the home page copy');
  });
});

describe('buildNextStepData', () => {
  const now = zonedTimeToUtc(2026, 10, 21, 10);
  const prev = (key: string, step: number, extra: Record<string, unknown> = {}) => ({
    id: 'w1',
    template_key: key,
    step,
    title: 'Collect the unpaid invoice INV-9',
    detail: null,
    owner_function_id: null,
    owner_user_id: null,
    owner_contact_id: null,
    client_id: 'c1',
    accord_id: null,
    project_id: null,
    charter_id: null,
    site_id: null,
    task_id: null,
    arc_id: null,
    approval_request_id: null,
    email_thread_id: null,
    email_account: null,
    blocks_client: false,
    client_waiting_since: null,
    action_payload: { subject: 'INV-9' },
    ...extra,
  });

  it('opens the next step keyed to the previous wait', () => {
    const n = buildNextStepData(prev('money.invoice', 1), now)!;
    expect(n.step).toBe(2);
    expect(n.idempotency_key).toBe('w1:next');
    expect(n.due_at.toISOString()).toBe(zonedTimeToUtc(2026, 11, 5, 10).toISOString());
    expect(n.title).toBe('Collect the unpaid invoice INV-9');
  });

  it('renders a step-specific title with the carried subject and changes the owner role', () => {
    const n = buildNextStepData(prev('money.invoice', 3), now)!;
    expect(n.title).toBe('Decide on the hold page for the unpaid invoice INV-9 in 5 days');
    expect(n.kind).toBe('approval');
    expect((n.action_payload as Record<string, unknown>).owner_role).toBe('mike');
  });

  it('returns null at the end of the chain or for an unknown template', () => {
    expect(buildNextStepData(prev('money.invoice', 5), now)).toBeNull();
    expect(buildNextStepData(prev('nope', 1), now)).toBeNull();
    expect(buildNextStepData(prev('build.gate_mike', 1), now)).toBeNull();
  });
});

describe('renderTitle', () => {
  it('fills the subject and collapses spaces', () => {
    expect(renderTitle('Approve {subject}', '  the sitemap ')).toBe('Approve the sitemap');
    expect(renderTitle('Approve {subject} now', '')).toBe('Approve now');
  });
});
