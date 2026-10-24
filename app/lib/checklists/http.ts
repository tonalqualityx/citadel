import { NextResponse } from 'next/server';
import type { ChecklistError } from './service';

const STATUS: Record<ChecklistError['code'], number> = {
  unknown_template: 400,
  wrong_kind: 400,
  client_not_found: 404,
  not_found: 404,
  item_not_found: 404,
  bad_state: 400,
  evidence_required: 400,
};

export function checklistErrorResponse(e: ChecklistError) {
  return NextResponse.json({ error: e.message, code: e.code }, { status: STATUS[e.code] });
}
