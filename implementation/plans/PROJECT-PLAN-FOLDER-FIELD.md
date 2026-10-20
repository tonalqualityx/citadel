# Project `plan_folder` field

Requested by Mike, 2026-10-20. Status: APPROVED by Mike 2026-10-20 (in session); building.

## Why

Multi-task projects now get a local plan folder at `~/Documents/projects/<slug>/` (convention in
`~/Documents/projects/README.md`). Workers only read their own task, so the project needs a reliable,
machine-readable pointer to that folder. Today the path rides in `notes` as free text.

## Change

One nullable text column on `projects`, settable on create and update, returned everywhere a project
is serialized, shown and editable in the UI.

| Layer | File | Change |
|---|---|---|
| Schema | `prisma/schema.prisma:852` (Project) | `plan_folder String?` beside `notes` |
| Migration | `prisma/migrations/20261020120000_project_plan_folder/migration.sql` | `ALTER TABLE "projects" ADD COLUMN "plan_folder" TEXT;` (additive, nullable, no backfill) |
| Create API | `app/api/projects/route.ts` zod (10-24) + data block (128-143) | `plan_folder: z.string().max(500).optional().nullable()`, pass through |
| Update API | `app/api/projects/[id]/route.ts` zod (15-27) + `updateData` (~256) | same zod line; `if (data.plan_folder !== undefined) updateData.plan_folder = data.plan_folder;` |
| Serializer | `lib/api/formatters.ts` `formatProjectResponse` (~218) | `plan_folder: project.plan_folder ?? null` (explicit whitelist, required) |
| Types | `lib/hooks/use-projects.ts` Project (~52), CreateProjectInput (~96) | `plan_folder: string \| null` / `plan_folder?: string \| null` |
| Form | `components/domain/projects/project-form.tsx` schema, defaults, payload, JSX near Notes (~288) | text input "Local plan folder", placeholder `/home/mike/Documents/projects/<slug>` |
| Display | `app/(app)/projects/[id]/page.tsx:1233-1238` | `<dt>Plan folder</dt><dd>` in monospace, shown when set |
| API docs | `lib/api/registry/projects.ts` POST body (58-70), PATCH body, response examples | add `plan_folder` (per `instructions/api-routes.md:104-110`) |

Validation: string up to 500 chars, nullable. No path-existence check (the server cannot see Bast's
machine). Empty string from the form saves as null.

## Tests

- `app/api/projects/[id]/__tests__/route.test.ts`: add a PATCH test that `plan_folder` reaches the
  update call, and that null clears it. Existing tests use `objectContaining`, so none break.
- New `app/api/projects/__tests__/route.test.ts` is out of scope (no existing file); covered by the
  serializer test below instead.
- Add a small `formatProjectResponse` test asserting `plan_folder` passes through and defaults to null.
- Gates: `npx tsc --noEmit`, `npm run lint`, `npm run test:run`. All must exit 0.

## Deploy

Push to `main` runs `.github/workflows/deploy.yml`: `npx prisma migrate deploy` then `pm2 restart`.
The migration is additive and nullable, so it is safe on a live table and rolls back by dropping the
column. Deploy only after Mike approves this plan.

## After deploy

- `~/.claude/tools/citadel-projects/scaffold-project-folder.py` already writes `plan_folder` when the
  API returns the field; re-run it on project 963c0454 to backfill.
- Worker instructions change (separate, reviewed by Mike): read `plan_folder` README before work.
