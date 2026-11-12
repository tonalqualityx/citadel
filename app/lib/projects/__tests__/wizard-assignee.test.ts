import { describe, it, expect } from 'vitest';
import { resolveWizardStepAssignee, resolveProjectManager } from '../wizard-assignee';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

describe('resolveWizardStepAssignee', () => {
  it('leaves a Bot step unassigned even when a member and a manager exist', () => {
    expect(resolveWizardStepAssignee({ functionName: 'Bot', pickedUserId: 'u1', managerUserId: 'm1' })).toBeNull();
    expect(resolveWizardStepAssignee({ functionName: ' bot ', pickedUserId: null, managerUserId: 'm1' })).toBeNull();
  });

  it('assigns a non-Bot step with no team member to the project manager', () => {
    expect(resolveWizardStepAssignee({ functionName: 'Design', pickedUserId: null, managerUserId: 'm1' })).toBe('m1');
  });

  it('assigns a non-Bot step with no team member and no manager to Mike', () => {
    expect(resolveWizardStepAssignee({ functionName: 'Design', pickedUserId: null, managerUserId: null })).toBe(MIKE_USER_ID);
  });

  it('keeps the picked team member over the manager', () => {
    expect(resolveWizardStepAssignee({ functionName: 'Design', pickedUserId: 'u1', managerUserId: 'm1' })).toBe('u1');
  });
});

describe('resolveProjectManager', () => {
  const fns = [{ id: 'fpm', name: 'Project Manager' }, { id: 'fd', name: 'Design' }];
  const creator = { userId: 'creator', role: 'pm' };
  it('prefers an explicit lead, then the PM-function member, then a pm/admin creator, then null', () => {
    expect(resolveProjectManager({ assignments: [{ function_id: 'fpm', user_id: 'a' }, { function_id: 'fd', user_id: 'b', is_lead: true }], functions: fns, creator })).toBe('b');
    expect(resolveProjectManager({ assignments: [{ function_id: 'fd', user_id: 'b' }, { function_id: 'fpm', user_id: 'a' }], functions: fns, creator })).toBe('a');
    expect(resolveProjectManager({ assignments: [{ function_id: 'fd', user_id: 'b' }], functions: fns, creator })).toBe('creator');
    expect(resolveProjectManager({ assignments: [], functions: [], creator: { userId: 'x', role: 'tech' } })).toBeNull();
  });
});
