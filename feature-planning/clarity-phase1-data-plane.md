# Clarity Phase 1 — Citadel Data Plane (arcs, session meaning, ideas, waiting-on-me)

Spec author: Bast (planning tier). Builder: implementation agent. Branch: `feat/clarity-phase1-data-plane`, worktree `~/.openclaw/workspace/citadel-clarity-wt`. Full system context in Bast memory `clarity-cockpit-system`.

## Purpose

Mike runs ~16 parallel Claude Code sessions plus the Citadel plus 2 inboxes. This phase gives the Citadel the data model so that: sessions can declare meaning (type/goal/ask), DO-work parked on Mike becomes real quests tied back to their session, related tasks group into lightweight "arcs" (micro-projects), ideas have a first-class home, and one endpoint serves everything waiting on Mike. Later phases add the producers (hooks/heartbeat) and the Oracle UI. This phase is schema + API + tests ONLY — no UI work.

## Hard rules

1. Work ONLY inside this worktree. Never touch `~/.openclaw/workspace/citadel` (main tree), prod, the heartbeat scripts in `~/.claude/tools/oracle/` (Phase 2 territory), or any crontab.
2. Migrations are ADDITIVE ONLY (new tables, nullable columns, new enum values). Never edit existing migrations, never `migrate reset`, never drop anything. Local DB: container `citadel-postgres`, `localhost:5433`, already running; `.env`/`.env.local` already in `app/`.
3. Baseline first: run `npm run test:run` on the untouched branch and record the passing count. That count is the floor — the existing suite must stay green untouched.
4. Executed gates, in order, all must pass before you report done: `npx prisma migrate dev` applies clean → full `npm run test:run` green (baseline + new tests) → `npm run build` clean. An unexecuted gate is a failed gate.
5. Mirror existing code style precisely: auth/validation patterns from `app/api/tasks/route.ts` and `app/api/focus-tasks/route.ts` (session auth, role scoping), zod + auth from `app/api/oracle/ingest/route.ts` for the ingest extension. Match existing test patterns (find the tests for those routes and imitate structure/helpers).
6. Commit in logical chunks with the repo's message style (`feat(scope): ...`), spec file included. Do NOT push.

## Schema (app/prisma/schema.prisma)

New enums:

```prisma
enum OracleSessionType { client_work internal systems exploratory }
enum AskQueue { decide answer review do }
enum AskSeverity { client_blocking launch_blocking internal }
enum IdeaSource { session oracle email }
enum IdeaStatus { open kept promoted discarded }
```

New model `Arc` (`@@map("arcs")`): id uuid PK; `name VarChar(300)`; `description Text?`; `client_id`/`client` optional relation to Client; `project_id`/`project` optional relation to Project (this is "attach arc to a commission" — tasks never re-parent); `origin_session_external_id VarChar(255)?` (the session that first spawned it); `closed_at DateTime?` (explicit ritual close); created_at/updated_at; `tasks Task[]`; indexes on project_id, client_id.

Arc STATUS IS NEVER STORED. Provide a pure helper (e.g. `lib/arc-status.ts`): `empty` (no tasks), `complete` (closed_at set, OR every task done/abandoned), else `open`. Unit-test the helper directly.

`Task` additions: `arc_id uuid?` + relation + index; `source_session_external_id VarChar(255)?` + index; `origin_url VarChar(1000)?` (future email deep-link; unused now, cheap to add while we're migrating). Extend the existing `TaskSource` enum with values `session` and `email` (additive `ALTER TYPE ... ADD VALUE`, same pattern as the Oracle `idle` status migration).

`OracleSession` additions (all nullable — old heartbeats keep working): `session_type OracleSessionType?`, `goal Text?`, `waiting_on Text?` (the literal ask parked on Mike), `ask_queue AskQueue?`, `ask_severity AskSeverity?`, `arc_id uuid?` + relation to Arc, `archived_at DateTime?` + index.

New model `Idea` (`@@map("ideas")`): id uuid PK; `text Text`; `source IdeaSource`; `source_ref VarChar(500)?` (session external_id / email id / etc.); `status IdeaStatus @default(open)`; `promoted_task_id uuid?` + relation to Task; `created_by uuid?`; created_at/updated_at; index on status.

One migration, name `clarity_phase1_arcs_ideas_session_meaning`.

## API

**`/api/arcs`** GET (list: derived status via helper, task counts, optional `?status=` filter on the derived value, `?client_id=`, `?project_id=`) and POST (name required; optional description/client_id/project_id). **`/api/arcs/[id]`** GET (detail with tasks) and PATCH (name, description, client_id, project_id, closed_at — setting closed_at is the "close thread" action; null reopens). Auth/roles mirror the tasks routes.

**`/api/ideas`** GET (`?status=`, default open) / POST (text required, source required, source_ref/created_by optional). **`/api/ideas/[id]`** PATCH (status, text, promoted_task_id). Same auth pattern.

**`/api/session-tasks`** POST — the quest-from-session endpoint. Bearer auth (same util the API already uses). Payload (zod): `session_external_id` (required), `title` (required, ≤500), `description?`, `arc_id?` XOR `arc_name?`, `client_id?`, `severity?` (AskSeverity), `assignee_id?`, `due_date?`.
- **Dedup:** if an existing Task has `source = session`, same `source_session_external_id`, status in (not_started, in_progress), and case-insensitive-trimmed title match → UPDATE its description/updated_at and return it with `deduped: true`. Never create a duplicate.
- **Arc resolution:** `arc_id` used as-is (404 if missing). `arc_name`: exact-name match among arcs with derived status ≠ complete → reuse; else create (origin_session_external_id = caller's session). Response includes the arc.
- **Defaults:** `source = session`, `source_session_external_id` set; assignee defaults to Mike's user (look up how the repo resolves the primary admin user — do not hardcode the UUID if a lookup pattern exists; if the repo has no such pattern, accept `assignee_id` as required-with-default-from-env `CLARITY_DEFAULT_ASSIGNEE_ID` read at request time); `needs_review = false`; priority from severity: client_blocking→1, launch_blocking→2, internal→3, absent→3.

**`/api/oracle/ingest`** extension — additive optional fields on the session payload: `session_type`, `goal`, `waiting_on`, `ask_queue`, `ask_severity`, `arc_id`. Upsert onto OracleSession. Semantics: field absent = leave stored value untouched; field explicitly `null` = clear it (heartbeat sends null when a session's ask is resolved). Length-cap goal/waiting_on (e.g. 2000). Payloads without any new fields must behave byte-for-byte as today (test this).

**`/api/waiting-on-me`** GET `?user_id=` — the merged feed. Auth scoping identical to `/api/focus-tasks` (tech users self-only; PM/Admin any user). Server-side merge of: the documented 5-query dashboard sweep (focus → overdue → awaiting-review → blocked → open-within-14d, each excluding IDs already emitted — reuse/extract the existing route logic rather than duplicating queries where practical) PLUS live OracleSessions where `waiting_on` is set, `archived_at` null, status not ended/stale. Response groups: `{ decide: [], answer: [], review: [], do: [], meta: {counts} }`. Session asks route by their `ask_queue`; review-queue tasks → `review`; all other task-sweep results → `do`. Each item carries enough to render a card: type (task|session_ask), title/ask text, severity or priority, source ids (task id / session external_id), arc info when present.

**Fleet route** (`/api/oracle/fleet`): exclude sessions with `archived_at != null` from the default response; `?include_archived=true` restores them. Nothing else about fleet changes.

## Tests (all new, vitest, alongside existing patterns)

- arc-status helper: empty/open/complete matrix incl. closed_at override and abandoned-only tasks.
- arcs + ideas routes: CRUD, validation failures, auth scoping.
- session-tasks: create, dedup-update (title case/whitespace variants), no-dedup when status done, arc_id vs arc_name paths (reuse open arc / skip complete arc / create new), severity→priority mapping, defaults.
- ingest: new fields persist; explicit-null clears; absent leaves untouched; legacy payload unchanged.
- waiting-on-me: grouping, cross-query ID dedup, session asks appear/disappear with waiting_on, auth scoping.
- fleet: archived exclusion + include_archived.

## Report back (final message)

Baseline test count vs final; migration name + "applied" evidence; each gate's actual result; commits (hash + message); any deviation from this spec with reasoning; anything discovered that Phase 2/3 should know.
