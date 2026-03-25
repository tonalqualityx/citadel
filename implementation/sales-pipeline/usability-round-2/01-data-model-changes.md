# Data Model Changes — Line Item Split & Keeps

## Overview

The single `AccordLineItem` table is replaced by three purpose-built tables: `AccordCharterItem`, `AccordCommissionItem`, and `AccordKeepItem`. Each has fields specific to its category. The `Ware` model gets renewal tracking fields. A new `Keep` concept is introduced for site-level hosting and maintenance bundled into deals.

---

## Terminology Update

| Standard | Awesome | Description |
|----------|---------|-------------|
| Site Service | Keep | Hosting + maintenance bundle for a site |
| Site Services | Keeps | Plural |

Add to `use-terminology.ts`:
- `keep` / `keeps` — Standard: "Site Service" / "Site Services", Awesome: "Keep" / "Keeps"
- `newKeep` — Standard: "New Site Service", Awesome: "New Keep"

---

## Tables to DROP

### AccordLineItem

This table is fully replaced by the three new tables below. All existing data in this table should be evaluated before dropping — if any AccordLineItems exist, they need manual review to determine which new table they belong in.

**Migration safety:** Check if any AccordLineItems exist in production before running destructive migration. If they do, write a data migration script that categorizes them based on their linked Ware type.

**Code cleanup required:**
- Remove `AccordLineItem` model from schema.prisma
- Remove `formatAccordLineItemResponse` from formatters.ts
- Remove all API routes for `/api/accords/[id]/line-items/`
- Remove `useAddAccordLineItem`, `useDeleteAccordLineItem` hooks
- Remove line item form and table from Accord detail page
- Remove `AccordLineItem` from all type definitions
- Remove from API registry

---

## New Tables

### AccordCharterItem

A recurring service line item on an Accord. Creates or attaches to a Charter when signed.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| accord_id | UUID (FK → Accord) | yes | |
| ware_id | UUID (FK → Ware) | yes | Must be a charter-type Ware |
| name_override | varchar(255) | no | Custom name for this line item |
| price_tier | varchar(100) | no | Selected tier name (e.g., "Medium") |
| base_price | Decimal(10,2) | yes | Price before discount (from Ware tier or manual) |
| discount_type | varchar(10) | no | `percent` or `flat` |
| discount_value | Decimal(10,2) | no | Discount amount (% or $) |
| final_price | Decimal(10,2) | yes | Calculated: base_price minus discount per period |
| billing_period | CharterBillingPeriod | yes | `monthly` or `annually` — inherited from Ware, overridable |
| duration_months | int | yes | Commitment length in months (e.g., 6, 12, 24) |
| total_contract_value | Decimal(10,2) | yes | Calculated: final_price × duration (normalized to months) |
| charter_id | UUID (FK → Charter) | no | Link to created Charter (populated after signing) |
| contract_language_override | text (HTML/BlockNote JSON) | no | Custom contract clause |
| addendum_id | UUID (FK → Addendum) | no | If added via addendum |
| sort_order | int | yes | |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Business rules:**
- `final_price` is calculated: if discount_type = 'percent', then base_price × (1 - discount_value/100). If 'flat', then base_price - discount_value.
- `total_contract_value`: if billing_period = 'monthly', then final_price × duration_months. If 'annually', then final_price × (duration_months / 12).
- When Accord is signed: creates Charter with start_date, duration, and the calculated renewal_date.

---

### AccordCommissionItem

A one-time project line item on an Accord. Links to a Project (Commission) for scope and pricing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| accord_id | UUID (FK → Accord) | yes | |
| ware_id | UUID (FK → Ware) | yes | Must be a commission-type Ware |
| name_override | varchar(255) | no | Custom name |
| estimated_price | Decimal(10,2) | no | Rough price before project is scoped (TBD if null) |
| project_id | UUID (FK → Project) | no | Linked project (null = not yet created) |
| discount_type | varchar(10) | no | `percent` or `flat` |
| discount_value | Decimal(10,2) | no | |
| final_price | Decimal(10,2) | no | From project budget_amount minus discount, or estimated_price minus discount if no project |
| contract_language_override | text (HTML/BlockNote JSON) | no | |
| addendum_id | UUID (FK → Addendum) | no | |
| sort_order | int | yes | |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Business rules:**
- `final_price` calculation: if project exists and has budget_amount, use that as base. Otherwise use estimated_price. Apply discount.
- A commission item can exist with no project and no price (TBD state). This is valid during early pipeline stages.
- When a project is linked, the price updates from the project's budget_amount.
- When Accord is signed: project.scope_locked = true, project.accord_id = this accord.

---

### AccordKeepItem

A site hosting + maintenance bundle line item on an Accord.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| accord_id | UUID (FK → Accord) | yes | |
| site_id | UUID (FK → Site) | no | Null if site not yet created |
| site_name_placeholder | varchar(255) | no | Descriptive name when site doesn't exist yet |
| domain_name | varchar(255) | no | Primary domain for the site (can be registered later) |
| hosting_plan_id | UUID (FK → HostingPlan) | no | Null if client-hosted |
| maintenance_plan_id | UUID (FK → MaintenancePlan) | yes | Always required — use $0 standard plan as minimum |
| hosting_price | Decimal(10,2) | no | From HostingPlan rate, overridable |
| hosting_discount_type | varchar(10) | no | `percent` or `flat` |
| hosting_discount_value | Decimal(10,2) | no | |
| hosting_final_price | Decimal(10,2) | no | Calculated |
| maintenance_price | Decimal(10,2) | yes | From MaintenancePlan rate, overridable |
| maintenance_discount_type | varchar(10) | no | |
| maintenance_discount_value | Decimal(10,2) | no | |
| maintenance_final_price | Decimal(10,2) | yes | Calculated |
| monthly_total | Decimal(10,2) | yes | hosting_final_price + maintenance_final_price |
| is_client_hosted | boolean | yes | Default false. If true, no hosting plan needed |
| contract_language_override | text (HTML/BlockNote JSON) | no | |
| addendum_id | UUID (FK → Addendum) | no | |
| sort_order | int | yes | |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Business rules:**
- `maintenance_plan_id` is always required. If nothing else, use the $0 standard plan.
- `hosting_plan_id` is null when `is_client_hosted = true`.
- When a site is created (from a Commission project or manually), link it here.
- When Accord is signed: site gets hosting_plan_id and maintenance_plan_id attached. If site doesn't exist yet, it gets attached when the site is created later.
- Hosting and maintenance prices import from plan rates but can be overridden (agency discounts, bundle deals).

---

## Ware Model Updates

### New Fields

| Field | Type | Description |
|-------|------|-------------|
| renewal_lead_time_days | int | Default 60. How many days before charter renewal to create a sales task |
| default_duration_months | int | no. Default commitment length for charter Wares (e.g., 12) |

### Clarification on Ware Types

Wares remain `commission` or `charter` type. **Keeps are NOT Wares** — they're built from existing HostingPlan and MaintenancePlan models. Keeps don't need a Ware because the pricing comes directly from the plan tables that already exist.

---

## Charter Model Updates

### New Fields

| Field | Type | Description |
|-------|------|-------------|
| duration_months | int | Commitment length from the AccordCharterItem |
| renewal_date | date | Calculated: start_date + duration_months |
| site_id | UUID (FK → Site), nullable | If this charter's work is tied to a specific site |

**Renewal tracking:** When a Charter is created from a signed Accord, `renewal_date` is calculated. A cron job or the existing sales automation system checks for upcoming renewals based on the Ware's `renewal_lead_time_days` and creates sales tasks (or even auto-creates a renewal Accord).

---

## Accord Model Updates

### New Computed Fields (API response, not stored)

| Field | Type | Description |
|-------|------|-------------|
| mrr | Decimal | Sum of: charter item final_prices (monthly-normalized) + keep item monthly_totals |
| total_project_value | Decimal | Sum of commission item final_prices |
| total_contract_value | Decimal | Sum of charter total_contract_values + keep monthly_totals × charter max duration + total_project_value |

### Updated Relations

Remove:
- `line_items: AccordLineItem[]`

Add:
- `charter_items: AccordCharterItem[]`
- `commission_items: AccordCommissionItem[]`
- `keep_items: AccordKeepItem[]`

---

## Lead Info — Make Editable

No schema changes needed. The lead fields already exist on the Accord model and are updateable via PATCH. The issue is purely UI — the Overview tab renders lead info as static text. Fix is in `02-accord-screen-rework.md`.

---

## Renewal Automation

### Cron Job: Charter Renewal Check

New endpoint: `POST /api/cron/charter-renewals`

**Logic:**
1. Find all active Charters where `renewal_date - renewal_lead_time_days <= today` and no renewal task/accord has been created yet
2. For each: create a sales task assigned to the Accord owner (or client's primary PM)
3. Task title: "Charter renewal upcoming: [Charter name] for [Client name]"
4. Task due date: renewal_date - renewal_lead_time_days
5. Link task to client and (optionally) auto-create a renewal Accord

**Idempotency:** Track in a `CharterRenewalLog` or use the existing SalesAutomationLog to prevent duplicate tasks.

### CharterRenewalLog

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | auto |
| charter_id | UUID (FK → Charter) | |
| renewal_date | date | The renewal date this log entry is for |
| task_id | UUID (FK → Task) | no. The task created for this renewal |
| accord_id | UUID (FK → Accord) | no. If a renewal Accord was auto-created |
| created_at | timestamp | auto |

**Unique constraint:** (charter_id, renewal_date)

---

## API Changes

### Remove
- `DELETE /api/accords/[id]/line-items` (all routes)
- Remove `useAddAccordLineItem`, `useDeleteAccordLineItem` hooks

### Add

**Charter Items:**
- `GET /api/accords/[id]/charter-items` — List
- `POST /api/accords/[id]/charter-items` — Add (validates Ware is charter type)
- `PATCH /api/accords/[id]/charter-items/[itemId]` — Update
- `DELETE /api/accords/[id]/charter-items/[itemId]` — Soft delete

**Commission Items:**
- `GET /api/accords/[id]/commission-items` — List
- `POST /api/accords/[id]/commission-items` — Add (validates Ware is commission type)
- `PATCH /api/accords/[id]/commission-items/[itemId]` — Update (including linking project)
- `DELETE /api/accords/[id]/commission-items/[itemId]` — Soft delete

**Keep Items:**
- `GET /api/accords/[id]/keep-items` — List
- `POST /api/accords/[id]/keep-items` — Add
- `PATCH /api/accords/[id]/keep-items/[itemId]` — Update (including linking site)
- `DELETE /api/accords/[id]/keep-items/[itemId]` — Soft delete

**Accord detail endpoint update:**
- `GET /api/accords/[id]` — Include charter_items, commission_items, keep_items instead of line_items
- Return computed mrr, total_project_value, total_contract_value

### Modify

**Accord formatter:** Replace `line_items` with three separate arrays. Add computed revenue fields.

---

## Migration Plan

1. Create new tables: AccordCharterItem, AccordCommissionItem, AccordKeepItem, CharterRenewalLog
2. Add new fields to Ware (renewal_lead_time_days, default_duration_months)
3. Add new fields to Charter (duration_months, renewal_date, site_id)
4. If any AccordLineItems exist: write migration script to move them to appropriate new table based on Ware type
5. Drop AccordLineItem table
6. Update Accord relations
7. Regenerate Prisma client
8. Restart dev server (lesson learned from the meeting_date incident)
