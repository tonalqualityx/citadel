import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';

const PM_FUNCTION_NAMES = new Set(['project manager', 'project management', 'pm']);

/**
 * The project's manager for fallback assignment. The wizard UI has no lead control, so in order:
 * an assignment flagged is_lead; the team member holding the Project Manager function; the creating user when
 * they are a pm or admin; otherwise null (the step resolver then falls back to Mike).
 */
export function resolveProjectManager(input: {
  assignments: Array<{ function_id: string; user_id: string; is_lead?: boolean }>;
  functions: Array<{ id: string; name: string }>;
  creator: { userId: string; role: string };
}): string | null {
  const lead = input.assignments.find((a) => a.is_lead);
  if (lead) return lead.user_id;
  const pmFunctionIds = new Set(input.functions.filter((f) => PM_FUNCTION_NAMES.has(f.name.trim().toLowerCase())).map((f) => f.id));
  const pm = input.assignments.find((a) => pmFunctionIds.has(a.function_id));
  if (pm) return pm.user_id;
  if (input.creator.role === 'pm' || input.creator.role === 'admin') return input.creator.userId;
  return null;
}

/**
 * Who a wizard-created step is assigned to.
 *
 * - Bot steps stay unassigned on purpose: they become work an agent can claim.
 * - Any other step takes the team member picked for its function; if none,
 *   the project's manager (see resolveProjectManager), otherwise Mike.
 */
export function resolveWizardStepAssignee(input: {
  functionName: string | null | undefined;
  pickedUserId: string | null | undefined;
  managerUserId: string | null | undefined;
}): string | null {
  if (input.functionName?.trim().toLowerCase() === 'bot') return null;
  return input.pickedUserId || input.managerUserId || MIKE_USER_ID;
}
