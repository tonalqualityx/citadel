# Sales Pipeline — Data Model & Relationships

## Overview

This document defines every new entity, field, relationship, and business rule for the Parley (Sales Pipeline) system. It covers Accords (deals), Wares (products/services), Charters (retainers), the Accord lifecycle, client portal tokens, MSA management, proposals, contracts, and addendums.

---

## Terminology Map

| Standard | Awesome | Description |
|----------|---------|-------------|
| Sales | Parley | Navigation section for sales pipeline |
| Deal | Accord | A sales opportunity moving through the pipeline |
| Product/Service | Ware | A service offering with pricing and contract language |
| Retainer | Charter | Ongoing service agreement with recurring tasks |
| Project | Commission | Finite project (renamed from Pact) |
| Addendum | Addendum | Modification to an existing Accord (same in both modes) |
| Proposal | Proposal | Sales document sent to prospective client |
| Contract | Contract | Legal agreement for signing |
| MSA | MSA | Master Services Agreement (same in both modes) |

**Note:** "Commission" replaces "Pact" throughout the system. The terminology hook (`use-terminology.ts`) must be updated.

---

## New Enums

### AccordStatus
```
lead → meeting → proposal → contract → signed → active → lost
```

**Transition rules:**
- `lead` → `meeting`, `lost`
- `meeting` → `proposal`, `lost`
- `proposal` → `contract` (auto, on client acceptance), `lost` (on client rejection or manual)
- `contract` → `signed` (auto, on client signing), `lost`
- `signed` → `active` (on payment confirmation — manual now, QB-automated later)
- `active` → (terminal for the sales pipeline; work is now tracked via Commissions/Charters)
- `lost` → `lead` (reopen)

### ProposalStatus
```
draft → sent → accepted → rejected → changes_requested
```

### ContractStatus
```
draft → sent → signed
```

### AddendumStatus
```
draft → sent → accepted → rejected → changes_requested
```

### WareType
```
commission | charter
```

### CharterBillingPeriod (for Charter-type Wares only)
```
monthly | annually
```

### CharterStatus
```
active | paused | cancelled
```

---

## New Entities

### Ware (Product/Service Catalog)

Managed in the Parley settings. Defines what Indelible sells.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| name | varchar(255) | yes | e.g., "SEO Retainer", "Website Build" |
| description | text (BlockNote JSON) | no | Rich text description of the service |
| type | WareType | yes | `commission` or `charter` |
| charter_billing_period | CharterBillingPeriod | no | For charter Wares only: `monthly` or `annually` |
| base_price | Decimal(10,2) | no | Default/starting price |
| price_tiers | JSON | no | Structured pricing tiers (e.g., Small/Medium/Large) |
| contract_language | text (HTML) | no | Default contract clause for this Ware |
| default_schedule | JSON | no | For charter Wares: default recurring task schedule template (SOP IDs + cadences) |
| recipe_id | UUID (FK → Recipe) | no | For commission Wares: default project template |
| sort_order | int | yes | Display ordering |
| is_active | boolean | yes | Default true |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Notes on Commission vs Charter Wares:**
- **Commission Wares** create Projects on signing. Projects already have their own billing model (`BillingType`: fixed/hourly/retainer/none), budget_hours, budget_amount, and Milestone-based billing. The Ware just provides the default Recipe template and contract language — all billing details live on the Project.
- **Charter Wares** create or attach to a Charter. The `charter_billing_period` and `default_schedule` fields only apply to these.

**Relations:**
- Has many AccordLineItems
- Optional FK to Recipe (for commission Wares that have a default project template)

---

### Accord (Deal)

The central sales pipeline entity. Lives in the Parley kanban.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| name | varchar(255) | yes | Deal name (e.g., "Acme Corp Website Redesign") |
| status | AccordStatus | yes | Current pipeline stage |
| client_id | UUID (FK → Client) | no | Null for leads not yet converted to clients |
| owner_id | UUID (FK → User) | yes | Person responsible (defaults to creator) |
| lead_name | varchar(255) | no | Contact name (for leads without a client record) |
| lead_business_name | varchar(255) | no | Business name (for leads without a client record) |
| lead_email | varchar(255) | no | Contact email |
| lead_phone | varchar(50) | no | Contact phone |
| lead_notes | text | no | Freeform notes about the lead |
| meeting_date | timestamp | no | Scheduled meeting date (set when moving to Meeting stage) |
| meeting_notes | text (BlockNote JSON) | no | Notes from the meeting |
| meeting_transcript_url | varchar(500) | no | Link to transcript (Google Drive, etc.) |
| meeting_recording_url | varchar(500) | no | Link to recording |
| rejection_reason | text | no | Client's reason for rejection (optional, captured on loss) |
| payment_confirmed | boolean | yes | Default false. Manual toggle now, QB-automated later. |
| payment_confirmed_at | timestamp | no | When payment was confirmed |
| payment_confirmed_by | UUID (FK → User) | no | Who confirmed payment |
| total_value | Decimal(10,2) | no | Calculated: sum of line item pricing |
| entered_current_status_at | timestamp | yes | When the Accord entered its current status (for time-based automation) |
| lost_at | timestamp | no | When moved to lost |
| signed_at | timestamp | no | When contract was signed |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Relations:**
- Optional FK to Client (null for unconverted leads)
- FK to User (owner)
- Has many AccordLineItems
- Has many AccordMeetingAttendees
- Has many Proposals
- Has many Contracts
- Has many Addendums
- Has many AccordCommissions (link to created projects)
- Has many AccordCharters (link to created retainers)

---

### AccordMeetingAttendee

Tracks who attended/is assigned to the meeting for this Accord.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| accord_id | UUID (FK → Accord) | yes | |
| user_id | UUID (FK → User) | yes | The Citadel user attending |
| created_at | timestamp | auto | |

**Unique constraint:** (accord_id, user_id)

---

### AccordLineItem

Links Wares to an Accord with deal-specific pricing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| accord_id | UUID (FK → Accord) | yes | |
| ware_id | UUID (FK → Ware) | yes | |
| name_override | varchar(255) | no | Custom name for this line item if different from Ware |
| description_override | text | no | Custom description |
| price | Decimal(10,2) | yes | Deal-specific price (for charter: per period; for commission: total or per-milestone — details live on the Project) |
| quantity | int | yes | Default 1 |
| commission_id | UUID (FK → Project) | no | Link to created Commission (populated after signing) |
| charter_id | UUID (FK → Charter) | no | Link to created/associated Charter (populated after signing) |
| contract_language_override | text (HTML) | no | Custom contract clause overriding the Ware default |
| sort_order | int | yes | |
| addendum_id | UUID (FK → Addendum) | no | Null for original items; FK to addendum that added this item |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Relations:**
- FK to Accord
- FK to Ware
- Optional FK to Project (Commission)
- Optional FK to Charter
- Optional FK to Addendum

---

### Proposal

A versioned sales document associated with an Accord.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| accord_id | UUID (FK → Accord) | yes | |
| version | int | yes | Auto-incrementing per Accord (1, 2, 3...) |
| content | text (HTML) | yes | The proposal content |
| status | ProposalStatus | yes | Default `draft` |
| pricing_snapshot | JSON | yes | Snapshot of AccordLineItems at time of creation |
| sent_at | timestamp | no | When sent to client |
| client_responded_at | timestamp | no | When client took action |
| client_note | text | no | Note from client (on changes_requested or rejection) |
| portal_token | varchar(128) | no | Secure token for client portal access |
| portal_token_expires_at | timestamp | no | Token expiry |
| created_by_id | UUID (FK → User) | yes | |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Unique constraint:** (accord_id, version)

**Relations:**
- FK to Accord
- FK to User (created_by)

---

### Contract

A versioned legal document for signing. Auto-generated from Accord line items + Ware contract language.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| accord_id | UUID (FK → Accord) | yes | |
| version | int | yes | Auto-incrementing per Accord |
| content | text (HTML) | yes | Generated contract content |
| msa_version_id | UUID (FK → MsaVersion) | yes | Which MSA version this contract references |
| status | ContractStatus | yes | Default `draft` |
| pricing_snapshot | JSON | yes | Snapshot of line items at contract generation |
| sent_at | timestamp | no | When sent to client |
| signed_at | timestamp | no | When client signed |
| signer_name | varchar(255) | no | Name of person who signed |
| signer_email | varchar(255) | no | Email of signer |
| signer_ip | varchar(45) | no | IP address at signing |
| signer_user_agent | text | no | Browser user agent at signing |
| content_snapshot | text (HTML) | no | Immutable copy of content at time of signing |
| portal_token | varchar(128) | no | Secure token for client portal access |
| portal_token_expires_at | timestamp | no | Token expiry |
| created_by_id | UUID (FK → User) | yes | |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Unique constraint:** (accord_id, version)

**Relations:**
- FK to Accord
- FK to MsaVersion
- FK to User (created_by)

---

### Addendum

A modification to an existing Accord. Follows the same client acceptance flow as a proposal.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| accord_id | UUID (FK → Accord) | yes | |
| version | int | yes | Auto-incrementing per Accord |
| title | varchar(255) | yes | e.g., "Add Social Media Management" or "Scope Change: Additional Pages" |
| description | text (HTML) | yes | What's changing and why |
| contract_content | text (HTML) | yes | The addendum contract language |
| status | AddendumStatus | yes | Default `draft` |
| pricing_snapshot | JSON | yes | Snapshot of changes |
| changes | JSON | yes | Structured: { added_items: [], removed_items: [], modified_items: [] } |
| sent_at | timestamp | no | |
| client_responded_at | timestamp | no | |
| client_note | text | no | Note from client on changes_requested/rejection |
| signed_at | timestamp | no | |
| signer_name | varchar(255) | no | |
| signer_email | varchar(255) | no | |
| signer_ip | varchar(45) | no | |
| signer_user_agent | text | no | |
| content_snapshot | text (HTML) | no | Immutable copy at signing |
| portal_token | varchar(128) | no | |
| portal_token_expires_at | timestamp | no | |
| is_override | boolean | yes | Default false. True if this was a minor change that Mike chose to skip client approval |
| override_reason | text | no | Why the addendum was overridden |
| overridden_by_id | UUID (FK → User) | no | |
| created_by_id | UUID (FK → User) | yes | |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Relations:**
- FK to Accord
- Has many AccordLineItems (items added by this addendum)
- FK to User (created_by, overridden_by)

---

### MsaVersion

Versioned Master Services Agreement. Per-organization (not per-client).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| version | varchar(20) | yes | e.g., "1.0", "1.1", "2.0" |
| content | text (HTML) | yes | Full MSA content |
| effective_date | date | yes | When this version became effective |
| is_current | boolean | yes | Only one should be true at a time |
| change_summary | text | no | What changed from previous version |
| created_by_id | UUID (FK → User) | yes | |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Relations:**
- Has many ClientMsaSignatures
- Has many Contracts (that reference this version)

---

### ClientMsaSignature

Tracks which MSA version each client has signed.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| client_id | UUID (FK → Client) | yes | |
| msa_version_id | UUID (FK → MsaVersion) | yes | |
| signed_at | timestamp | yes | |
| signer_name | varchar(255) | yes | |
| signer_email | varchar(255) | yes | |
| signer_ip | varchar(45) | no | |
| signer_user_agent | text | no | |
| portal_token | varchar(128) | no | Token used for signing |
| created_at | timestamp | auto | |

**Unique constraint:** (client_id, msa_version_id)

**Business rule:** When a contract is generated, check if the client has signed the current MSA. If not, the MSA signing must happen before or as part of the contract signing flow.

---

### Charter (Retainer)

An ongoing service agreement. Independent entity, lives in the Foundry.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| name | varchar(255) | yes | e.g., "Acme Corp SEO Retainer" |
| client_id | UUID (FK → Client) | yes | |
| accord_id | UUID (FK → Accord) | no | The Accord that created this Charter (null if created independently) |
| status | CharterStatus | yes | Default `active` |
| billing_period | CharterBillingPeriod | yes | `monthly` or `annually` |
| budget_hours | Decimal(6,2) | no | Allocated hours per billing period |
| hourly_rate | Decimal(8,2) | no | Rate for this Charter |
| budget_amount | Decimal(10,2) | no | Fixed amount per period (alternative to hourly) |
| start_date | date | yes | When the Charter begins |
| end_date | date | no | Null for indefinite |
| paused_at | timestamp | no | |
| cancelled_at | timestamp | no | |
| cancellation_reason | text | no | |
| created_by_id | UUID (FK → User) | yes | |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Relations:**
- FK to Client
- Optional FK to Accord
- FK to User (created_by)
- Has many CharterWares
- Has many CharterScheduledTasks
- Has many CharterCommissions (related projects drawing from budget)
- Has many Tasks (one-off tasks directly on the Charter)

---

### CharterWare

Links Wares to a Charter with specific pricing (may differ from the Accord pricing if modified later).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| charter_id | UUID (FK → Charter) | yes | |
| ware_id | UUID (FK → Ware) | yes | |
| accord_line_item_id | UUID (FK → AccordLineItem) | no | Links back to the original line item |
| price | Decimal(10,2) | yes | Current price for this Ware on this Charter |
| is_active | boolean | yes | Default true. False when Ware removed from Charter |
| deactivated_at | timestamp | no | |
| addendum_id | UUID (FK → Addendum) | no | If added via an addendum |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Relations:**
- FK to Charter
- FK to Ware
- Optional FK to AccordLineItem
- Has many CharterScheduledTasks (schedules for this specific Ware)

---

### CharterScheduledTask

Defines a recurring task template for a Charter. Each entry generates tasks on its cadence.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| charter_id | UUID (FK → Charter) | yes | |
| charter_ware_id | UUID (FK → CharterWare) | no | Which Ware this schedule is for (null for general Charter tasks) |
| sop_id | UUID (FK → Sop) | yes | The SOP template to generate tasks from |
| cadence | varchar(20) | yes | `weekly`, `monthly`, `quarterly`, `semi_annually`, `annually` |
| sort_order | int | yes | |
| is_active | boolean | yes | Default true |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Relations:**
- FK to Charter
- Optional FK to CharterWare
- FK to Sop

---

### CharterGenerationLog

Tracks recurring task generation for Charters. Same idempotency pattern as MaintenanceGenerationLog.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| charter_id | UUID (FK → Charter) | yes | |
| scheduled_task_id | UUID (FK → CharterScheduledTask) | yes | |
| period | varchar(20) | yes | e.g., "2026-03", "2026-Q1" |
| tasks_created | int | yes | |
| tasks_abandoned | int | yes | Previous period's incomplete tasks abandoned |
| generated_at | timestamp | auto | |

**Unique constraint:** (charter_id, scheduled_task_id, period)

---

### CharterCommission

Links a Commission (project) to a Charter for budget allocation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| charter_id | UUID (FK → Charter) | yes | |
| commission_id | UUID (FK → Project) | yes | The project drawing from this Charter's budget |
| allocated_hours_per_period | Decimal(6,2) | no | Hours allocated per billing period |
| start_period | varchar(20) | yes | e.g., "2026-03" — when allocation begins |
| end_period | varchar(20) | no | When allocation ends (null = until Commission completes) |
| is_active | boolean | yes | Default true. Set false when Commission completes |
| completed_at | timestamp | no | When the Commission was completed |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**Relations:**
- FK to Charter
- FK to Project (Commission)

**Business rule:** When a Commission's status transitions to `done`, automatically set `is_active = false` and `completed_at = now()` on the CharterCommission record. It then appears in the archive section of the Charter screen.

---

### PortalSession

Tracks client portal access for security and audit.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| token_type | varchar(20) | yes | `proposal`, `contract`, `addendum`, `msa` |
| entity_id | UUID | yes | ID of the proposal, contract, addendum, or MSA being accessed |
| ip_address | varchar(45) | yes | |
| user_agent | text | no | |
| action | varchar(20) | yes | `viewed`, `accepted`, `rejected`, `changes_requested`, `signed` |
| metadata | JSON | no | Additional data (client notes, rejection reasons, etc.) |
| created_at | timestamp | auto | |

---

### SalesAutomationRule

Global automation rules for the sales pipeline.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| name | varchar(255) | yes | Human-readable rule name |
| trigger_type | varchar(20) | yes | `status_change` or `time_at_status` |
| trigger_status | AccordStatus | yes | Which pipeline status triggers this rule |
| trigger_from_status | AccordStatus | no | For status_change: only trigger when coming FROM this status |
| time_threshold_hours | int | no | For time_at_status: hours before triggering |
| action_type | varchar(20) | yes | `create_task` (extensible later) |
| task_template | JSON | yes | Task creation template: { title, description, priority, energy_estimate, assignee_rule } |
| assignee_rule | varchar(20) | yes | `accord_owner`, `meeting_attendees`, `specific_user` |
| assignee_user_id | UUID (FK → User) | no | For `specific_user` rule |
| is_active | boolean | yes | Default true |
| sort_order | int | yes | |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

**`assignee_rule` options:**
- `accord_owner` — assign to the Accord's owner
- `meeting_attendees` — assign to all meeting attendees (creates one task per attendee)
- `specific_user` — assign to a hardcoded user

---

## Modifications to Existing Entities

### Client

Add fields:
| Field | Type | Description |
|-------|------|-------------|
| has_signed_msa | boolean (computed) | Whether client has signed the current MSA version |

**New relations:**
- Has many ClientMsaSignatures
- Has many Charters
- Has many Accords

**Note:** Existing `retainer_hours` and `hourly_rate` fields on Client remain for now. Migration to Charter model is future work documented separately.

### Project (Commission)

Add fields:
| Field | Type | Description |
|-------|------|-------------|
| accord_id | UUID (FK → Accord), nullable | The Accord this Commission came from |
| scope_locked | boolean, default false | Whether scope is locked (set when Accord is signed) |
| scope_locked_at | timestamp, nullable | When scope was locked |

**Modified behavior:**
- When `scope_locked = true` and a user adds a task to this project, prompt: "This Commission is under contract. Does this require an addendum?" with options: "Prepare Addendum" or "Override (minor change)."
- Override creates an Addendum record with `is_override = true` and logs the override reason.
- "Prepare Addendum" opens the addendum creation flow, allowing multiple tasks to be added before sending to client.

### Task

Add fields:
| Field | Type | Description |
|-------|------|-------------|
| charter_id | UUID (FK → Charter), nullable | For tasks belonging to a Charter |
| accord_id | UUID (FK → Accord), nullable | For sales-pipeline tasks (follow-ups, etc.) |

### Terminology (use-terminology.ts)

Updated TERMS:
| Key | Standard | Awesome |
|-----|----------|---------|
| project / projects | Project / Projects | Commission / Commissions |
| deal / deals | Deal / Deals | Accord / Accords |
| retainer / retainers | Retainer / Retainers | Charter / Charters |
| product / products | Product / Products | Ware / Wares |
| sales | Sales | Parley |
| addendum / addendums | Addendum / Addendums | Addendum / Addendums |
| newDeal | New Deal | New Accord |
| newRetainer | New Retainer | New Charter |
| newProduct | New Product | New Ware |

---

## Business Rules Summary

1. **Lead → Client conversion:** When an Accord without a `client_id` reaches `signed`, the portal onboarding flow collects client info and creates the Client record.
2. **Proposal acceptance → Contract auto-generation:** When client accepts a proposal, the system auto-generates a contract from Ware contract language + pricing, and advances the Accord to `contract` status. The contract page loads directly after acceptance.
3. **MSA gating:** Before a contract can be signed, the system checks if the client has signed the current MSA. If not, MSA signing is presented first.
4. **Contract signing → Commission/Charter creation:** On signing, for each AccordLineItem: if Ware type is `commission`, create or link a Project. If Ware type is `charter`, create or update a Charter.
5. **Payment gate:** Contract signed but Accord doesn't move to `active` until `payment_confirmed = true`. Manual toggle now; QB integration later.
6. **Scope lock:** When an Accord reaches `signed`, all linked Commissions get `scope_locked = true`.
7. **Addendum flow:** Adding tasks to a scope-locked Commission prompts for addendum or override. Multiple tasks can be batched into one addendum before sending.
8. **Charter recurring tasks:** Generated by cron on the same schedule pattern as maintenance tasks. Each CharterScheduledTask has its own cadence.
9. **Commission completion:** When a Commission linked to a Charter completes (`done` status), the CharterCommission is marked inactive and archived.
10. **Time-based automation:** Cron checks Accords where `entered_current_status_at + threshold < now()` and creates tasks per matching SalesAutomationRules.
11. **Meeting transcript task:** When Accord moves to `meeting` and meeting_date is set, if no transcript links exist 24 hours after the meeting_date, create a task for each meeting attendee.

---

## Entity Relationship Summary

```
Client ─────────────────┬── Accords (deals)
  │                     │     ├── AccordLineItems ── Wares
  │                     │     ├── AccordMeetingAttendees
  │                     │     ├── Proposals (versioned)
  │                     │     ├── Contracts (versioned)
  │                     │     └── Addendums (versioned)
  │                     │
  ├── ClientMsaSignatures ── MsaVersions
  │
  ├── Charters (retainers)
  │     ├── CharterWares ── Wares
  │     ├── CharterScheduledTasks ── SOPs
  │     ├── CharterGenerationLog
  │     ├── CharterCommissions ── Projects
  │     └── Tasks (one-off)
  │
  └── Projects (commissions)
        ├── (existing project structure)
        └── accord_id (FK back to Accord)
```
