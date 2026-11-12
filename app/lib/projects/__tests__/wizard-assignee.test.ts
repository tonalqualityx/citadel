import { describe, it, expect } from 'vitest';
import { resolveWizardStepAssignee } from '../wizard-assignee';
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
