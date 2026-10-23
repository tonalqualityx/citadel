import { describe, it, expect } from 'vitest';
import { parseGovern, governTaskId } from '../govern';

const U = '11111111-1111-4111-8111-111111111111';

describe('parseGovern', () => {
  it('accepts every intent with its fields', () => {
    expect(parseGovern({ intent: 'approval_request', task_id: U, snapshot: { preview_url: 'https://p.test/x' } })).toEqual({ intent: 'approval_request', task_id: U, snapshot: { preview_url: 'https://p.test/x' } });
    expect(parseGovern({ intent: 'approval_mail', task_id: U, approval_request_id: U })).toMatchObject({ intent: 'approval_mail', approval_request_id: U });
    expect(parseGovern({ intent: 'golive', task_id: U, snapshot: { before_live: true } })).toMatchObject({ snapshot: { claimed: false, before_live: true } });
    expect(parseGovern({ intent: 'magic_link', snapshot: { expires_at: '2026-10-23T00:00:00Z' } })).toBeTruthy();
    expect(parseGovern({ intent: 'invite', snapshot: { expires_at: '2026-10-23T00:00:00Z' } })).toBeTruthy();
    expect(parseGovern({ intent: 'proposal', proposal_id: U })).toBeTruthy();
    expect(parseGovern({ intent: 'contract', contract_id: U })).toBeTruthy();
    expect(parseGovern({ intent: 'chat', task_id: U })).toBeTruthy();
    expect(parseGovern({ intent: 'notice_internal', task_id: U })).toBeTruthy();
    expect(parseGovern({ intent: 'none', reason: 'digest' })).toEqual({ intent: 'none', reason: 'digest' });
  });
  it('refuses junk', () => {
    for (const bad of [null, 'x', [], {}, { intent: 'nope' }, { intent: 'golive' }, { intent: 'golive', task_id: 'not-a-uuid' }, { intent: 'magic_link', snapshot: {} }, { intent: 'none' }, { intent: 'none', reason: '  ' }]) {
      expect(parseGovern(bad)).toBeNull();
    }
  });
  it('reads the task id when there is one', () => {
    expect(governTaskId({ intent: 'chat', task_id: U })).toBe(U);
    expect(governTaskId({ intent: 'none', reason: 'x' })).toBeNull();
  });
});
