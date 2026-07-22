import { describe, it, expect } from 'vitest';
import { crisisFromLabel, hasCrisis, SEVERITY_LABEL } from '../crisis-strip-logic';
import type { EmailAsk } from '@/lib/hooks/use-waiting-on-me';

function ask(overrides: Partial<EmailAsk> = {}): EmailAsk {
  return {
    id: 'ask-1',
    message_id: 'msg-1',
    thread_id: null,
    account: 'mike@becomeindelible.com',
    from_name: null,
    from_email: 'client@herba.com',
    subject: 'Site is down',
    gist: 'Client reports site is down',
    queue: 'do',
    severity: 'client_blocking',
    is_urgent: true,
    state: 'open',
    training_note: null,
    task_id: null,
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
    received_at: '2026-07-21T20:00:00.000Z',
    created_at: '2026-07-21T20:00:00.000Z',
    updated_at: '2026-07-21T20:00:00.000Z',
    ...overrides,
  };
}

describe('hasCrisis', () => {
  it('is false for an empty array', () => {
    expect(hasCrisis([])).toBe(false);
  });

  it('is true when at least one ask is present', () => {
    expect(hasCrisis([ask()])).toBe(true);
  });
});

describe('crisisFromLabel', () => {
  it('includes the name when present', () => {
    expect(crisisFromLabel({ from_name: 'Jane Client', from_email: 'jane@herba.com' })).toBe(
      'Jane Client <jane@herba.com>'
    );
  });

  it('falls back to just the email when no name', () => {
    expect(crisisFromLabel({ from_name: null, from_email: 'jane@herba.com' })).toBe('jane@herba.com');
  });
});

describe('SEVERITY_LABEL', () => {
  it('has a direct label for every AskSeverity value', () => {
    expect(SEVERITY_LABEL.client_blocking).toBe('client-blocking');
    expect(SEVERITY_LABEL.launch_blocking).toBe('launch-blocking');
    expect(SEVERITY_LABEL.internal).toBe('internal');
  });
});
