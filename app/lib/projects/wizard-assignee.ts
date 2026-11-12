import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

/**
 * Who a wizard-created step is assigned to.
 *
 * - Bot steps stay unassigned on purpose: they become work an agent can claim.
 * - Any other step takes the team member picked for its function; if none,
 *   the project's manager (the team lead), otherwise Mike.
 */
export function resolveWizardStepAssignee(input: {
  functionName: string | null | undefined;
  pickedUserId: string | null | undefined;
  managerUserId: string | null | undefined;
}): string | null {
  if (input.functionName?.trim().toLowerCase() === 'bot') return null;
  return input.pickedUserId || input.managerUserId || MIKE_USER_ID;
}
