// Clarity Phase 8 (composition) — the signals rail: quiet, lights only for things that
// truly need Mike (crisis, promised-due-today, sessions needing him). DAY-REALITY #6 (the
// anxiety check-in cure): "Nothing needs you right now — if it did, it would be here" is
// the product, earned by the capture system — it must be a literal, byte-exact string a
// test can assert on, never paraphrased at render time.
export type SignalKind = 'crisis' | 'promised_due_today' | 'session_needs_you';

export interface Signal {
  kind: SignalKind;
  label: string;
  count: number;
  tone: 'error' | 'warning' | 'quiet';
}

export const SIGNALS_EMPTY_COPY = 'Nothing needs you right now — if it did, it would be here.';

// Cron chips are NOT part of this list — they're a live, self-fetching component
// (<CronHealthLine bullet={false} />) appended after the signals row; it already renders
// nothing when every cron is healthy/snoozed/dismissed, which satisfies "cron chips render
// inside Work's signals area only when attention needed, not a separate region."
export function buildSignals(input: {
  crisisCount: number;
  promisedDueTodayCount: number;
  sessionsNeedingYouCount: number;
}): Signal[] {
  const signals: Signal[] = [];
  if (input.crisisCount > 0) {
    signals.push({
      kind: 'crisis',
      label: `${input.crisisCount} crisis ${input.crisisCount === 1 ? 'item needs' : 'items need'} you`,
      count: input.crisisCount,
      tone: 'error',
    });
  }
  if (input.promisedDueTodayCount > 0) {
    signals.push({
      kind: 'promised_due_today',
      label: `${input.promisedDueTodayCount} promised ${input.promisedDueTodayCount === 1 ? 'task is' : 'tasks are'} due today`,
      count: input.promisedDueTodayCount,
      tone: 'warning',
    });
  }
  if (input.sessionsNeedingYouCount > 0) {
    signals.push({
      kind: 'session_needs_you',
      label: `${input.sessionsNeedingYouCount} ${input.sessionsNeedingYouCount === 1 ? 'session needs' : 'sessions need'} you`,
      count: input.sessionsNeedingYouCount,
      tone: 'warning',
    });
  }
  return signals;
}
