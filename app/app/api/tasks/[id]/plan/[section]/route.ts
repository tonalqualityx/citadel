import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { ApiError, handleApiError } from '@/lib/api/errors';
import { checkTaskAccess } from '@/lib/services/task-patch';
import { assertCanReadPlan, assertCanWritePlan, patchSection, putSection } from '@/lib/tasks/plan';
import { PLAN_SECTION_TITLES, isSection, patchBody, putBody } from '@/lib/tasks/plan-schema';

async function prepare(request: NextRequest, params: Promise<{ id: string; section: string }>) {
  const auth = await requireAuth();
  const { id, section } = await params;
  const task = await checkTaskAccess(id, auth);
  assertCanReadPlan(task, auth);
  await assertCanWritePlan(task, auth, request.headers);
  if (!isSection(section)) throw new ApiError(`Unknown plan section. Use one of: ${Object.keys(PLAN_SECTION_TITLES).join(', ')}.`, 404, 'plan_unknown_section');
  return { auth, task, section };
}

/**
 * PUT /api/tasks/:id/plan/:section   { items: [ {id?: uuid, ...fields} ], description?: string }
 * Replaces one section's items. An item with an `id` keeps that line (and its Mark wrong flag while the words are unchanged); an item
 * without one is new; lines not listed are removed. Sections: requirements, dates, team, billing, examples, decisions. Item fields are in
 * lib/tasks/plan-schema.ts (every field is validated; a bad field answers 400 with the first problem in plain words).
 * Writers: Mike's session, the enforced chat lane, the Dox lane under its project binding. Returns { section, items }.
 * Leaves a change line ("Plan: Billing model updated by the chat") and, while the card is in Triage, raises triage_rev.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; section: string }> }) {
  try {
    const { auth, task, section } = await prepare(request, params);
    const body = putBody.parse(await request.json());
    const items = await putSection(task, auth, section, body.items, body.description);
    return NextResponse.json({ section, items });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/tasks/:id/plan/:section   one of
 *   { op: 'add', item }  |  { op: 'change', id, item }  |  { op: 'remove', id }  |  { op: 'mark_wrong', id, wrong: boolean }   (each with optional description)
 * Adds, rewrites (the whole item), removes or flags one line. mark_wrong is Mike's (session or the chat relaying him): the line stays, shown
 * struck with "Mike marked this wrong", and the chat reads the flag from GET and corrects the line (a rewritten line loses the flag).
 * Returns { section, items } after the change.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; section: string }> }) {
  try {
    const { auth, task, section } = await prepare(request, params);
    const body = patchBody.parse(await request.json());
    const items = await patchSection(task, auth, section, body);
    return NextResponse.json({ section, items });
  } catch (error) {
    return handleApiError(error);
  }
}
