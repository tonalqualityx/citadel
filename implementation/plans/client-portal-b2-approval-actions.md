# Feature: [B2] Client Portal — wire the 3 approval actions

## Overview
B1 shipped the token-gated task-approval page with 3 stub buttons (Approve / Something's not
right / Add a new task). B2 wires each to a real token-gated endpoint and makes them work
end-to-end. No client login exists yet (C1 pending), so the **per-task token is the
authorization** and the acting contact is resolved from the task's client.

## Contact resolution (token-only flow)
There is no client session. Resolve the acting contact as:
`task.requested_by_contact_id` → else the client's `is_primary` contact → else null.
- Approve records `approved_by_contact_id` = resolved contact (nullable; `client_approved_at`
  is the authoritative "approved" marker regardless).
- "Add a new task" site dropdown lists the resolved contact's client's sites; defaults to the
  task's own site.

## Files to Create
- [ ] `/app/app/api/portal/tasks/[token]/approve/route.ts` — POST: set `client_approved_at` +
      `approved_by_contact_id`; if `site.auto_deploy === false` flag promotion-pending (record
      only — no deploy infra in-app); log portal `accept` session. Idempotent.
- [ ] `/app/app/api/portal/tasks/[token]/request-changes/route.ts` — POST {note}: status →
      `not_started`; store the note as a client-visible comment (authored by Bast, `is_internal:false`);
      log portal `changes_requested` session.
- [ ] `/app/app/api/portal/tasks/[token]/new-task/route.ts` — POST {title, description, site_id}:
      validate site_id ∈ contact's client's sites; create task (status `not_started`,
      `source:'portal'`, `requested_by_contact_id`, assignee = Bast for triage); log session.
- [ ] `__tests__/route.test.ts` for the three new routes (extend existing portal tasks test file).

## Files to Modify
- [ ] `/app/lib/services/portal.ts` — `validateTaskToken`: extend `include` to load `site`
      (auto_deploy, client_id, name) + `client` (with primary contact) + `requested_by_contact`,
      so the action routes can resolve contact/sites without extra queries.
- [ ] `/app/app/api/portal/tasks/[token]/route.ts` (GET) — additively return `contact`
      ({id,name}|null) and `available_sites` ([{id,name}]) for the new-task form. Existing fields
      unchanged.
- [ ] `/app/app/(portal)/portal/task-approval/[token]/page.tsx` — wire the 3 buttons: confirm/note
      UI, POST to the endpoints, show result, refresh state. Replace the "wired in B2" stub copy.
- [ ] `/app/lib/api/registry/portal.ts` — add the 3 new POST endpoints; note the GET additions.

## Implementation Steps
1. Extend `validateTaskToken` include (site/client/contact).
2. Add contact-resolution helper (`resolveTaskContact`) in portal service.
3. Create the three POST routes.
4. Extend GET response with `contact` + `available_sites`.
5. Wire the page UI.
6. Update registry.
7. Tests + gates.

## Tests to Update (from Impact Analysis)
- [ ] `app/app/api/portal/tasks/__tests__/route.test.ts` — GET still returns existing fields
      (additive change). Add coverage for new `contact`/`available_sites` fields and the 3 POST
      routes. Existing assertions unchanged.
- [ ] `app/lib/api/__tests__/client-projections.test.ts` — `formatTaskForClient` unchanged → no
      edits expected; verify still green.

## Tests to Write
- [ ] approve: sets client_approved_at + approved_by_contact_id; idempotent when already approved;
      404 on bad token; logs accept session.
- [ ] request-changes: status→not_started; creates client-visible comment with the note; 404 bad token.
- [ ] new-task: creates task with requested_by_contact_id + Bast assignee on a valid site; rejects a
      site_id outside the contact's client; 404 bad token.

## Verification Checklist
- [ ] Type check clean (tsc --noEmit)
- [ ] Full test suite passes (incl. new tests)
- [ ] Production build succeeds
- [ ] One reversible commit; CI green after push (Citadel auto_deploy=true → ships to main)
