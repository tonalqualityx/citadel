/**
 * The one place a Triage card's revision is bumped when a session changes it (the triage-desk lane calls this after every change it makes).
 * It is a no-op in this branch on purpose: the branch that adds `Task.triage_rev` (feat/triage-plan-tab) replaces the BODY of this function and
 * leaves the signature alone, so the two branches merge without touching the same lines.
 *
 *   taskId  the Triage card
 *   who     who changed it: 'session' for the triage-desk lane
 *   what    a one-line description of the change, plain words (shown as "changed by a session: <what>")
 */
export async function bumpTriageRev(taskId: string, who: string, what: string): Promise<void> {
  void taskId;
  void who;
  void what;
}
