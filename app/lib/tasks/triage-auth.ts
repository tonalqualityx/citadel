import { ApiError } from '@/lib/api/errors';
import { mayLeaveTriage } from '@/lib/services/task-patch';

/** Who may read or sort a Triage card: Mike signed in, or the enforced bast-chat lane (the same check as leaving Triage). Everyone else is refused. */
export const TRIAGE_CARD_FORBIDDEN = 'Only Mike can sort a card in Triage.';

export function requireTriageOwner(auth: Parameters<typeof mayLeaveTriage>[0]): void {
  if (!mayLeaveTriage(auth)) throw new ApiError(TRIAGE_CARD_FORBIDDEN, 403, 'triage_forbidden');
}
