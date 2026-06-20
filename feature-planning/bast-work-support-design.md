# Feature Scope: Citadel support for the Bast autonomous-work system

**Status:** scope only — 2026-06-20. NOT built. The Citadel-side changes needed so the Bast
triage + worker loops (a mirror of the Saiph auto-triage model) can run against Citadel tickets
and Eleventy client sites. See `~/.openclaw` memory `bast-autonomous-work-vision` for the full vision.

## Why
The loops need Citadel to: (a) have a **Bast identity** to assign work to, (b) store enough
**deploy/staging config** to execute Eleventy changes, (c) carry **triage/worker state** the
status enum doesn't cover, (d) know **what Bast (vs people) can do**, and (e) hold per-client
**voice/branding** for the quality gates. Most of the work-item machinery already exists.

## Already exists — do NOT rebuild
- **Task:** review/approval workflow (`needs_review` defaults true, `reviewer_id`, `approved` /
  `approved_by_id` / `approved_at`), `sop_id` link, `requirements` + `review_requirements`
  (Quality Gate), `assignee_id`, `status`, `priority`, `site_id`/`client_id`, comments,
  dependencies, `created_by_id`.
- **Sop:** TipTap `content`, `tags[]`, function classification, task-template defaults
  (`needs_review`, `template_requirements`, `setup_requirements`, priority/energy).
- **Site:** `url` (prod), `repo_url`, `repo_branch`, `content_dir`, `site_type`
  (eleventy|wordpress|handoff), `wp_*` fields.
- **UserFunction:** people↔function capability matrix (already models "who can do what").
- **ClientContact + `GET /api/contacts/resolve`** (authority for client work) — shipped.
- **Comment** (author = the Bast service user → gives the Saiph "~ Bast" provenance for free).
- **ActivityLog** (audit trail).

## Gaps to fill (tiered)

### Tier 1 — foundational (the worker-loop pilot needs these)
1. **Bast service user** — ✅ DONE (Mike created it: `bast@becomeindelible.com`, role `pm`). Still
   needed: an **API key** for the cron to authenticate AS Bast (so comments/assignments/activity
   attribute to Bast). Mike generates it (settings UI logged in as Bast, or `POST /api/api-keys`)
   and drops it where the cron reads it (e.g. `~/.citadel-bast-token`). Bast (the agent) does not
   handle the credential itself.
2. **Site staging/deploy config** (extend `Site`):
   - `staging_url` (default convention `staging.{primary-domain}` — store it, defaulting to the
     convention so exceptions are possible), `staging_branch` (default `staging`),
     `prod_branch` (or treat `repo_branch` as prod — clarify),
   - `staging_auth_user` / `staging_auth_password` (basic auth). PURPOSE per Mike: keep Google +
     bots out, not real security — if someone gets past it there's little to do. **Plain storage
     and serving via the (authed) API is fine.** The point is the client FEELS it's behind a wall
     the public won't see. (Deploy layer also sets `noindex` + basic-auth on the staging dir.)
   - Deploy mechanics (rsync, Cloudways/Cloudflare purge) stay in the **repo's GH Action**, not
     Citadel — the proven KNT/Botanical-Dream pattern. Citadel only needs the pointers above.
3. **`Task.tags[]`** (mirror `Sop.tags`: `tags String[] @default([])`). Carries Saiph-style
   states the status enum can't: `bast-doable`, `needs-info`, `possible-duplicate`,
   `needs-mike`/`escalated`, `awaiting-client-approval`, `staged`, `gate-failed`,
   `new-sop-candidate`. Cleaner than exploding `TaskStatus`.
   Tags (on both `Sop` and `Task`) also carry **classification namespaces** (multi-value), so a
   work item / SOP can declare what it applies to: `stack:eleventy` / `stack:wordpress` (omit =
   stack-agnostic; tag both = applies to both) and `kind:launch` / `kind:troubleshoot` /
   `kind:content` / `kind:setup`. Tag filters and the tags-display UI must handle these
   namespaced classification tags alongside the triage-state tags above.
4. **Task source/provenance** (extend `Task`): `source` (enum `portal|email|internal`),
   `source_ref` (message-id / portal-id), `requested_by_contact_id` (→ `ClientContact`). Anchors
   the ticket to the authorized contact who requested it — and who approves staging. (Needed
   because `reviewer_id` is a `User` and clients are NOT users; see #8.)
5. **Capability gate — TWO flags (AND'd), for client-by-client rollout:**
   - `Sop.bast_executable` (Boolean) — this *kind* of work is automatable in principle.
   - `Site.bast_enabled` (Boolean, default false) — Bast is turned on for THIS site.
   Bast auto-executes only when **both** are true (SOP is bast-executable AND the site is
   bast-enabled). Lets us prove Bast on Alder before any other client, even for work-types it can
   already do elsewhere. No match / either flag false → triage/escalate. Pairs with `Task.sop_id`.
   DECISION: confirm the two-flag model (vs SOP-only).

### Tier 2 — triage + branding layer
6. **Client branding/voice** — a related **`BrandProfile`** model (preferred over fields on
   `Client`; it will grow): `voice_profile` (text/JSON for the voice-test), `figma_url` (design
   language link), `component_library_ref` (which client component library), plus brand
   notes/colors/fonts as needed. Feeds the voice + design gates.
7. **New-SOP-candidate flow** — lightweight: a `new-sop-candidate` tag + a digest surface; when a
   human resolves a no-SOP ticket, Bast drafts an SOP candidate from the resolution. No heavy
   schema.
8. **Client-approval modeling** — clients aren't `User`s, so model the staging sign-off
   explicitly: task fields `staging_preview_url`, `staging_deployed_at`, `client_approved_at`,
   `approved_by_contact_id` (→ `ClientContact`) + the `awaiting-client-approval` tag. Keeps "who
   approved" auditable without forcing clients into the user table.

### Tier 3 — later / outside Citadel
- **Client portal** (ticket submission) — a separate app/surface; Citadel only needs to accept
  portal-sourced tickets (Tier-1 #4 covers intake). Big build, tracked separately.
- **Quality-gate result storage** — gate runs live in CI; Citadel needs only pass/fail to gate the
  flow (a tag or comment). Optionally store a last-run summary JSON on the task later. Minimal now.

## Decisions
1. ✅ Bast service user — `bast@becomeindelible.com`, role `pm` (created by Mike).
2. ✅ Staging-auth — store plain, serving via the authed API is fine (purpose = keep Google/bots out).
3. ✅ Triage state via `Task.tags[]` (also carries the `stack:` / `kind:` classification namespaces).
4. ✅ Client approval — `approved_by_contact_id` (→ `ClientContact`), no pseudo-user.
5. ✅ Branding — dedicated `BrandProfile` model, deferred to Tier 2 (separate pass).
6. ✅ Capability gate — two-flag model confirmed: `Sop.bast_executable` AND `Site.bast_enabled`.
7. ⏳ **API key** — Mike generates a Bast-user key and places it at `~/.citadel-bast-token`; the cron reads from there. Agent does not handle the credential.

## Build checklist (once decided)

**Tier 1 (worker-loop foundation):**
- [ ] Prisma: `Task.tags[]` + source/provenance (`source`/`source_ref`/`requested_by_contact_id`) +
      client-approval fields (`staging_preview_url`/`staging_deployed_at`/`client_approved_at`/
      `approved_by_contact_id`); `Site` staging fields + `bast_enabled`; `Sop.bast_executable`;
      migration.
- [ ] API: task create/update + filters (tags incl. `stack:`/`kind:` namespaces, source,
      `assignee_id=Bast` queue drain); site staging-config CRUD; SOP `bast_executable`. Registry.
- [ ] UI: Site form staging fields + `bast_enabled` toggle; task tags display; SOP
      `bast_executable` toggle.
- [ ] Bast-user API key generated by Mike + placed for the cron.
- [ ] Tests + `tsc --noEmit` + full suite green (zero broken).

**Tier 2 (separate pass):** `BrandProfile` model + `Client` relation + CRUD + UI panel;
new-SOP-candidate surfacing.
