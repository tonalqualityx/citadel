// Clarity Phase 3 (Seeing Stone Reckoning, spec Q14) — cron chips v1. Pure,
// dependency-free helpers (no React, no fetch), same logic/dumb-component split used
// throughout this domain.
import type { ErroringCron } from '@/components/domain/oracle/oracle-logic';

/** A cron's stable identity for snooze/dismiss persistence — machine name + display
 *  title. Deliberately NOT a session id: each cron run mints a fresh OracleSession row,
 *  so a session-scoped key would never survive past the current run. */
export function cronKey(machineName: string, title: string): string {
  return `${machineName}::${title}`;
}

export interface CronChipStateRow {
  cron_key: string;
  snoozed_until: string | null;
  dismissed_reason: string | null;
}

/**
 * Filters the raw erroring-cron list down to the chips that should actually render:
 * drops a cron that's snoozed (snoozed_until in the future) and drops a cron whose
 * CURRENT attention_reason exactly matches what was dismissed (a changed/new reason —
 * even for the same cron — counts as "re-fired" and reappears immediately).
 */
export function visibleCronChips(
  crons: ErroringCron[],
  states: CronChipStateRow[],
  nowMs: number
): ErroringCron[] {
  const stateByKey = new Map(states.map((s) => [s.cron_key, s]));

  return crons.filter((cron) => {
    const state = stateByKey.get(cronKey(cron.machineName, cron.title));
    if (!state) return true;

    if (state.snoozed_until) {
      const until = new Date(state.snoozed_until).getTime();
      if (!Number.isNaN(until) && until > nowMs) return false;
    }

    if (state.dismissed_reason !== null && state.dismissed_reason === (cron.attentionReason ?? null)) {
      return false;
    }

    return true;
  });
}
