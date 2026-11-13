/**
 * The release version of a Triage card: a short hash of everything Release depends on. The card payload carries it; the tap sends it
 * back; the server refuses (409 card_changed) when it no longer matches, so a tap never does something other than what the owner read.
 * Pure: no database.
 */
import { createHash } from 'node:crypto';

export interface ReleaseVersionInput {
  kind: string | null;
  assignee_id: string | null;
  project_id: string | null;
  project_status: string | null;
  site_id: string | null;
  client_id: string | null;
  /** Open questions only. */
  questions: { id: string; if_nobody_action: string }[];
}

export const CARD_CHANGED_MESSAGE = 'That card changed after you read it. Nothing was released. Look at it again.';

export function releaseVersion(i: ReleaseVersionInput): string {
  const qs = [...i.questions].sort((a, b) => a.id.localeCompare(b.id)).map((q) => `${q.id}:${q.if_nobody_action}`);
  const canon = JSON.stringify([i.kind, i.assignee_id, i.project_id, i.project_status, i.site_id, i.client_id, qs]);
  return createHash('sha256').update(canon).digest('hex').slice(0, 32);
}
