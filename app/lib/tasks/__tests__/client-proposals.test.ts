import { describe, it, expect } from 'vitest';
import { CLIENT_PROPOSAL_TAG, PLAN_APPROVAL_TAG, clientProposalWhere, toClientProposal, proposalClientName, type ProposalRow } from '../client-proposals';

const row = (over: Partial<ProposalRow> = {}): ProposalRow => ({
  id: '6d713653-0bbd-4ede-9b07-75ee91bad42d',
  title: 'Feature the pre-order menu',
  created_at: new Date('2026-11-15T12:00:00Z'),
  client: { name: 'Alder Vermont' },
  site: { name: 'aldervt.com', client: { name: 'Site Owner' } },
  ...over,
});

describe('clientProposalWhere', () => {
  const w = clientProposalWhere();
  it('needs BOTH the origin tag and the still-waiting tag, so the emailed yes (which drops plan-approval) clears it', () => {
    expect(w.AND).toEqual([{ tags: { has: CLIENT_PROPOSAL_TAG } }, { tags: { has: PLAN_APPROVAL_TAG } }]);
    expect(CLIENT_PROPOSAL_TAG).toBe('client-proposal');
    expect(PLAN_APPROVAL_TAG).toBe('plan-approval');
  });
  it('skips deleted tasks and tasks already done, dropped or in status triage (those show as ordinary cards)', () => {
    expect(w.is_deleted).toBe(false);
    expect(w.status).toEqual({ notIn: ['triage', 'done', 'abandoned'] });
  });
  it('does not match the client route park tag, so a plan that went to the client first is not shown as waiting on him', () => {
    expect(JSON.stringify(w)).not.toContain('client-plan-approval');
  });
});

describe('toClientProposal', () => {
  it('carries the client name, link and age', () => {
    const p = toClientProposal(row(), new Date('2026-11-18T12:00:00Z'));
    expect(p).toMatchObject({ client_name: 'Alder Vermont', site_name: 'aldervt.com', href: '/tasks/6d713653-0bbd-4ede-9b07-75ee91bad42d', age_days: 3 });
  });
  it('falls back to the site client, then null', () => {
    expect(proposalClientName(row({ client: null }))).toBe('Site Owner');
    expect(proposalClientName(row({ client: null, site: null }))).toBeNull();
  });
});
