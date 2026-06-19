# Feature Scope: Authorized Contacts (email-check authorization gate)

## Why

The `email-check` skill (Bast) is being added to `support@becomeindelible.com`. When a
non-Reshi email arrives it must decide whether the sender is allowed to initiate work for a
client, then route it (simple edit vs task, who to assign). The hard rule: **never start work
for anyone who is not definitively authorized for that client.**

Citadel is the source of truth for clients, so it needs to hold the authorized-contacts list.
Today it cannot: `Client` has a single `email` field and a `primary_contact` name string, with
no concept of multiple people or an authorization flag.

The other half of the routing ("does this client have an Eleventy/Wright build?") is **modeled**
via `Site.site_type = eleventy`, but is not reliably set today (see "Site type" below). It is the
right field to key on; the work is making sure it actually gets populated.

## What the skill needs from Citadel

1. Resolve a raw sender email to the client(s) it is authorized for, plus whether that contact
   may initiate work, plus whether the client has an Eleventy site.
2. A place for Reshi to manage that list per client.

Everything else (simple-vs-complex judgement, assigning to Reshi vs Sabeen) stays in the skill
and uses existing `User` records. No schema change for assignees.

## Data model

New model `ClientContact` (one client to many contacts). A person who works for more than one
client gets one row per client, which is what we want for agency contacts.

```prisma
model ClientContact {
  id                String   @id @default(uuid()) @db.Uuid
  client_id         String   @db.Uuid
  client            Client   @relation(fields: [client_id], references: [id])
  name              String?  @db.VarChar(255)
  email             String   @db.VarChar(255)
  role              String?  @db.VarChar(100)   // "Owner", "Marketing Lead", etc.
  can_initiate_work Boolean  @default(false)    // THE gate flag
  is_primary        Boolean  @default(false)
  notes             String?  @db.Text
  is_deleted        Boolean  @default(false)
  created_at        DateTime @default(now())
  updated_at        DateTime @updatedAt

  @@unique([client_id, email])   // same email allowed across different clients
  @@index([email])               // fast sender resolution
  @@index([client_id])
  @@map("client_contacts")
}
```

Add `contacts ClientContact[]` to `Client`. Keep `Client.email` / `primary_contact` for now
(display + back-compat); `ClientContact` is the authoritative list.

## Key endpoint: resolve a sender

`GET /api/contacts/resolve?email=<addr>` returns every non-deleted contact matching that email,
each with its client and that client's **full list of sites with enough context to tell them
apart** (a client can have several, and the routing depends on which one the email is about):

```jsonc
{
  "email": "editor@thevermontstandard.com",
  "matches": [
    {
      "contact_id": "...", "name": "...", "role": "Editor",
      "can_initiate_work": true,
      "client": { "id": "...", "name": "Vermont Standard", "type": "direct", "status": "active" },
      "sites": [
        { "id": "...", "name": "The Vermont Standard", "url": "https://thevermontstandard.com",
          "site_type": "wordpress", "domains": ["thevermontstandard.com"],
          "notes": "Main newspaper site." },
        { "id": "...", "name": "Wheels to Learning", "url": "https://wheelstolearningvt.org",
          "site_type": "eleventy", "domains": ["wheelstolearningvt.org"],
          "notes": "Education nonprofit project run by the Standard." }
      ]
    }
  ]
}
```

Each site carries `name`, `url`, `site_type`, `domains`, and `notes` so the skill can reason
about which site an email is about **from the email's content**, not from the sender's domain.

Skill logic, in order:

1. **Authorize the sender.**
   - 0 matches -> unconfirmed -> forward to Reshi.
   - matches exist but none `can_initiate_work` -> known but not authorized -> forward to Reshi.
   - matches span >1 client -> ambiguous client -> forward to Reshi (do not ask the client this).
   - exactly one authorized client -> continue.
2. **Pick the site from EMAIL CONTEXT (not sender domain).** A contact's email domain says nothing
   about which site they mean: people at `herbapumps.com` also run `botanicaldream.com` and never
   email from it. Read the subject/body and match its content against each site's `name`, `notes`,
   `url`, and `domains` (e.g. body mentions "wheels to learning" -> the wheelstolearningvt.org
   site). Then:
   - client has 1 site -> use it.
   - content clearly identifies exactly one site -> use it.
   - **still unclear (0 or >1 plausible)** -> **reply-all to the client ONCE** to confirm
     ("Just to confirm, is this about <best-guess-site>?" or "Which site is this for?"). Record
     `awaiting_site_clarification` on the thread in the ledger. When the client replies: if it now
     resolves -> proceed; if still unclear -> **forward to Reshi.** Never ask a second time.
3. **Route** on the chosen site's `site_type`: `eleventy` -> simple edit by Bast or task to Reshi
   for complex; otherwise -> task to Sabeen (simple/design) or Reshi (complex).

This single endpoint is the whole integration surface for the skill. The one-time clarification
reply is the only client-facing email Bast may send without Reshi's approval (see skill).

## CRUD + UI

- API: `GET/POST /api/clients/[id]/contacts`, `PATCH/DELETE /api/contacts/[id]` (soft delete),
  following the existing route + registry + Zod + `handleApiError` conventions.
- UI: a "Contacts" section on the Client detail page. Rows of name / email / role with a
  `can_initiate_work` toggle and `is_primary` marker; add + edit + delete.
- Activity logging on create/update/delete per the standard service.

## Site type: structured field, not freeform "platform"

The routing's Eleventy check must key on the structured `Site.site_type` enum
(`eleventy | wordpress | handoff`), never on the freeform `Site.platform` string (inconsistent
free text: "WP", "Wordpress", "11ty" ... unreliable for automation).

Current gap: `site_type` already exists and Troubador uses it, but the **main Site form
(`components/domain/site-form.tsx`) only exposes the freeform "Platform" input.** `site_type` is
only settable from the separate publishing card, so most sites have it null.

In scope here:
- Add a proper `site_type` **enum selector** to the main Site create/edit form, labeled so it is
  clear this drives automation. Keep `platform` as an optional free-text detail (version notes,
  e.g. "WordPress 6.4"), not the source of truth.
- Backfill / prompt: existing sites with null `site_type` need a value, so the resolve endpoint
  returns the correct `site_type` for whichever site the email is matched to.

## Migration / backfill (Reshi's call: primary contact is authorized by default)

Add the table. For each existing client with a `Client.email`, create one `ClientContact` with
`is_primary = true` **and `can_initiate_work = true`** (the primary contact can always request
work by default), carrying over `primary_contact` as the name. Any number of additional contacts
can then be added per client, each authorized or not via the toggle. The `can_initiate_work` flag
stays editable even on the primary, for the rare billing-only-contact edge case.

## Decisions (locked with Reshi)

1. **Backfill:** primary contact is seeded as authorized (`can_initiate_work = true`,
   `is_primary = true`); unlimited additional contacts can be added and authorized per client.
2. **Granularity:** single `can_initiate_work` boolean for v1.
3. **Sequencing:** full CRUD + UI in one pass (model, resolve endpoint, contacts API, Client-page
   UI, and the Site-form `site_type` selector all together).

## Explicitly out of scope (v1)

- Permission levels beyond the single boolean (an enum can come later if real cases demand it).
- Per-contact notification preferences or portal access.
- Auto-discovering contacts from email history.
- Per-client default assignee for simple work (routing uses a global default: Sabeen for
  simple/design, Reshi for complex).

## Downstream skill change (separate, after this ships)

Replace the email-check skill's INTERIM fail-safe ("treat every non-Reshi sender as
unconfirmed, forward to Reshi") with a real call to `/api/contacts/resolve` and the logic above.
Until then the skill stays in fail-safe mode, so shipping this is non-breaking.

## Build checklist (for the dev session)

Follows Citadel's Plan -> Implement -> Test workflow; promote to `implementation/plans/` when picked up.

- [ ] Prisma: add `ClientContact` model + `Client.contacts` relation; migration.
- [ ] Backfill script: seed primary contacts as authorized per the rule above.
- [ ] API: `GET /api/contacts/resolve?email=` (returns each match's client + full `sites[]` with
      `site_type`, `domains`, and `notes` so the skill can disambiguate from email content);
      `GET/POST /api/clients/[id]/contacts`; `PATCH/DELETE /api/contacts/[id]`. Update the registry.
- [ ] UI: Contacts section on the Client detail page (add/edit/delete, authorize toggle).
- [ ] Site form: add `site_type` enum selector; demote `platform` to optional detail.
- [ ] Activity logging on contact create/update/delete.
- [ ] Tests: resolve-endpoint logic (0 / single-client / multi-client / known-unauthorized) and
      site-matching (single site / multi-site matched / multi-site ambiguous), contacts CRUD,
      `tsc --noEmit`, no regressions.
- [ ] After ship: swap the email-check skill's interim fail-safe for the real resolve call.
```
