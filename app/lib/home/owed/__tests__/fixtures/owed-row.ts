import type { OwedRow } from '../../state';
import { NOW } from '../../../__tests__/fixtures/tonight';

export function makeRow(over: Partial<OwedRow> = {}): OwedRow {
  return {
    thread_key: 'thread:a:b',
    state: 'queued',
    request_kind: null,
    requested_at: null,
    draft_id: null,
    draft_hash: null,
    draft_for_ask_id: null,
    drafted_at: null,
    mike_edited_at: null,
    attempts: 0,
    updated_at: NOW,
    bast_read: null,
    suggested_answer: null,
    draft_text: null,
    ...over,
  };
}
