# Sales Pipeline — Phased Build Plan

## Overview

This document breaks the Parley system into sequenced implementation phases. Each phase delivers usable functionality and builds on the previous. Dependencies are called out explicitly.

---

## Pre-Implementation Work

Before writing any code, Claude Code dispatches sub-agents for:

### A. Component Audit
Sub-agent reviews the existing component library at `/components/ui/` and `/components/domain/` to identify:
- Reusable components (DataTable, TaskList, Modal, Drawer, forms, inline editors, etc.)
- Components that need extension (e.g., kanban board from existing dnd-kit usage)
- Gaps requiring new components
- Output: `implementation/sales-pipeline/component-audit.md`

### B. Conflict Analysis
Sub-agent crawls the codebase identifying potential conflicts:
- Terminology changes (Pact → Commission throughout)
- Existing retainer logic on Client model vs new Charter model
- Project type enum (project/retainer/internal) — impact of adding Charter as separate entity
- Status transition logic changes
- Navigation/routing changes
- Hook and query key impacts
- API registry updates needed
- Output: `implementation/sales-pipeline/conflict-analysis.md`

### C. Test Baseline
Sub-agent runs all existing tests, documents current state:
- Which tests pass/fail
- Test coverage map
- Tests that will need modification (retainer-related, project type references, terminology)
- Output: `implementation/sales-pipeline/test-baseline.md`

---

## Phase 1: Foundation — Data Model & Terminology

**Goal:** Database schema, terminology rename, and basic API scaffolding. No UI yet.

**Duration estimate:** N/A (see SOUL.md — no time estimates)

### 1.1 Terminology Rename: Pact → Commission
- Update `use-terminology.ts` TERMS object
- Add new terms: deal/deals, retainer/retainers, product/products, sales, newDeal, newRetainer, newProduct
- Update all components referencing "Pact" terminology
- Update tests
- **Constraint:** All existing tests must pass after this change

### 1.2 Prisma Schema — New Enums
- AccordStatus, ProposalStatus, ContractStatus, AddendumStatus
- WareType, WareBillingCycle, CharterStatus, CharterBillingPeriod
- Add to schema.prisma, generate migration

### 1.3 Prisma Schema — New Entities
Create in this order (respecting foreign key dependencies):
1. Ware
2. MsaVersion
3. Accord
4. AccordMeetingAttendee
5. AccordLineItem
6. Proposal
7. Contract
8. Addendum
9. ClientMsaSignature
10. Charter
11. CharterWare
12. CharterScheduledTask
13. CharterGenerationLog
14. CharterCommission
15. PortalSession
16. SalesAutomationRule

### 1.4 Prisma Schema — Existing Entity Modifications
- Project: add `accord_id`, `scope_locked`, `scope_locked_at`
- Task: add `charter_id`, `accord_id`
- Generate migration, test against existing data

### 1.5 API Formatters
- Create formatters for all new entities (following existing pattern in `lib/api/formatters.ts`)

### 1.6 API Registry
- Register all new endpoints in `lib/api/registry/`
- New domain files: `accords.ts`, `wares.ts`, `charters.ts`, `portal.ts`, `msa.ts`

**Phase 1 exit criteria:**
- [ ] All new tables created and migrated
- [ ] Terminology updated, all references to "Pact" → "Commission"
- [ ] All existing tests pass
- [ ] New formatters written and tested

---

## Phase 2: Wares & Accords CRUD

**Goal:** Basic CRUD for Wares and Accords. Kanban board. No client-facing features yet.

**Dependencies:** Phase 1 complete

### 2.1 Wares API
- `GET /api/wares` — List with pagination, search, type filter
- `POST /api/wares` — Create (PM/Admin)
- `GET /api/wares/[id]` — Detail
- `PATCH /api/wares/[id]` — Update
- `DELETE /api/wares/[id]` — Soft delete
- Zod validation schemas
- Tests for all endpoints

### 2.2 Wares UI
- Wares list screen (`/deals/wares`)
- Ware create/edit form (modal or page)
- Contract language editor (rich text / HTML)
- Default schedule builder (for Charter Wares — SOP selector + cadence)
- Recipe selector (for Commission Wares)

### 2.3 Accords API
- `GET /api/accords` — List with pagination, search, status filter, owner filter
- `POST /api/accords` — Create
- `GET /api/accords/[id]` — Detail with line items, meeting info, proposals, contracts
- `PATCH /api/accords/[id]` — Update
- `DELETE /api/accords/[id]` — Soft delete
- `PATCH /api/accords/[id]/status` — Status transition with validation
- `POST /api/accords/[id]/line-items` — Add line item
- `PATCH /api/accords/[id]/line-items/[lineItemId]` — Update line item
- `DELETE /api/accords/[id]/line-items/[lineItemId]` — Remove line item
- `POST /api/accords/[id]/meeting-attendees` — Add attendee
- `DELETE /api/accords/[id]/meeting-attendees/[attendeeId]` — Remove attendee
- Tests for all endpoints

### 2.4 Accords Kanban UI
- Kanban board component (extend existing dnd-kit patterns)
- Accord card component
- Drag-and-drop between pipeline columns
- Status transition validation on drop
- Filters: owner, date range

### 2.5 Accord Detail UI
- Overview tab: lead/client info, line items table, activity timeline
- Meeting tab: date, attendees, transcript/recording links, notes
- New Accord creation form

### 2.6 Navigation Update
- Add Parley section to sidebar
- Add Accords and Wares nav items
- Update routing

### 2.7 React Query Hooks
- `useAccords()`, `useAccord()`, `useCreateAccord()`, `useUpdateAccord()`, etc.
- `useWares()`, `useWare()`, `useCreateWare()`, `useUpdateWare()`, etc.
- Query key factories for both

**Phase 2 exit criteria:**
- [ ] Wares CRUD fully functional
- [ ] Accords CRUD fully functional with kanban view
- [ ] Line items, meeting info, attendees all manageable
- [ ] Navigation updated
- [ ] All tests pass

---

## Phase 3: Proposals & MSA

**Goal:** Proposal creation, versioning, preview, and sending. MSA management.

**Dependencies:** Phase 2 complete, SendGrid configured

### 3.1 SendGrid Integration
- Email service abstraction (`lib/services/email.ts`)
- SendGrid API client setup
- Email template rendering (HTML)
- Send queue / error handling

### 3.2 MSA API & Management
- `GET /api/msa` — List versions
- `POST /api/msa` — Create new version (Admin)
- `GET /api/msa/[id]` — Version detail
- `PATCH /api/msa/[id]` — Update (only if not yet signed by anyone)
- `GET /api/msa/current` — Current version
- `GET /api/clients/[id]/msa-status` — Client's MSA signing status
- MSA management UI in Parley Settings

### 3.3 Proposal API
- `POST /api/accords/[id]/proposals` — Create new version
- `GET /api/accords/[id]/proposals` — List versions
- `GET /api/accords/[id]/proposals/[proposalId]` — Detail
- `PATCH /api/accords/[id]/proposals/[proposalId]` — Update draft
- `POST /api/accords/[id]/proposals/[proposalId]/send` — Generate token, send email, update status
- Tests

### 3.4 Proposal UI (Internal)
- Proposal tab on Accord detail
- HTML content editor for proposal body
- Preview mode (renders as client would see it)
- Version list with status badges
- Send button with confirmation
- Status indicators (draft, sent, waiting, accepted, etc.)

### 3.5 Proposal Portal (Client-Facing)
- `/portal/proposal/[token]` — Public route, no auth
- Clean, branded layout
- Rendered proposal content + pricing summary
- Accept / Request Changes / Reject buttons
- Changes requested: text area for note
- Rejection: optional reason text area
- On accept: auto-generate contract, load contract view
- Token validation and expiry
- PortalSession logging

### 3.6 MSA Portal
- `/portal/msa/[token]` — Standalone MSA signing
- MSA content rendered
- Signer info + sign button
- ClientMsaSignature created on sign
- Confirmation + email

### 3.7 Internal Notifications
- Proposal accepted/rejected/changes_requested → notify Accord owner
- Uses existing notification system (in-app + email + Slack based on preferences)

**Phase 3 exit criteria:**
- [ ] Email sending works via SendGrid
- [ ] MSA versions manageable, clients can sign via portal
- [ ] Proposals: create, edit, preview, send, version
- [ ] Client portal: view proposal, accept/reject/request changes
- [ ] Acceptance auto-generates contract and advances Accord
- [ ] All internal notifications fire correctly
- [ ] All tests pass

---

## Phase 4: Contracts & Signing

**Goal:** Contract generation, client signing, PDF generation, onboarding flow.

**Dependencies:** Phase 3 complete

### 4.1 Contract Generation Engine
- `lib/services/contract-generator.ts`
- Assembles contract from: Ware contract language + line item pricing + boilerplate
- Respects contract_language_override on AccordLineItems
- Creates pricing table
- References MSA version
- Generates HTML content stored on Contract entity

### 4.2 Contract API
- `POST /api/accords/[id]/contracts` — Generate new contract version
- `GET /api/accords/[id]/contracts` — List versions
- `GET /api/accords/[id]/contracts/[contractId]` — Detail
- `PATCH /api/accords/[id]/contracts/[contractId]` — Edit before sending
- `POST /api/accords/[id]/contracts/[contractId]/send` — Generate token, send email
- Tests

### 4.3 Contract UI (Internal)
- Contract tab on Accord detail
- Generated contract preview
- Edit capability before sending
- Version list
- Send button
- Status tracking

### 4.4 Contract Portal (Client-Facing)
- `/portal/contract/[token]` — Public route
- MSA section (if not yet signed): content + agreement checkbox
- Contract content rendered
- Pricing table
- Signer name + email inputs
- Agreement checkbox + Sign button
- On sign:
  - Create immutable content_snapshot
  - Log signer IP, user agent
  - Create ClientMsaSignature if MSA was signed simultaneously
  - Advance Accord to `signed`
  - Send confirmation email with contract copy
  - PortalSession logging

### 4.5 PDF Generation
- Server-side HTML-to-PDF rendering
- Use Puppeteer/Playwright to render portal page
- `GET /api/portal/contract/[id]/pdf` — Download PDF
- Include in confirmation email as attachment or link

### 4.6 Portal Onboarding
- `/portal/onboard/[token]` — Appears after contract signing for leads without Client record
- Collects business info
- Creates Client record, links to Accord
- Redirects to confirmation page

### 4.7 Signing → Activation Flow
- On contract sign:
  - Accord status → `signed`
  - Notify Accord owner
- On payment confirmation (manual toggle):
  - Accord status → `active`
  - For each CommissionType line item: create Project (from Recipe if available) or link existing, set `scope_locked = true`
  - For each Charter-type line item: create Charter with CharterWares and CharterScheduledTasks from Ware defaults
  - Create CharterCommission links if Commissions are associated with a Charter

### 4.8 Email Notifications
- Contract ready email to client
- Contract signed confirmation to client (with PDF)
- Contract signed notification to Accord owner
- Payment confirmed → Commissions/Charters created notification

**Phase 4 exit criteria:**
- [ ] Contracts auto-generated from Wares + pricing
- [ ] Client can sign via portal (with MSA if needed)
- [ ] PDF generation works
- [ ] Onboarding captures client info for leads
- [ ] Signing triggers Commission/Charter creation
- [ ] Payment gate works (manual)
- [ ] All emails send correctly
- [ ] All tests pass

---

## Phase 5: Charters (Retainers)

**Goal:** Charter management screens, recurring task generation, budget allocation.

**Dependencies:** Phase 4 complete

### 5.1 Charter API
- `GET /api/charters` — List with pagination, client filter, status filter
- `POST /api/charters` — Create (standalone, outside Accord flow)
- `GET /api/charters/[id]` — Detail with Wares, schedules, tasks, commissions
- `PATCH /api/charters/[id]` — Update
- `PATCH /api/charters/[id]/status` — Status transitions (active/paused/cancelled)
- `POST /api/charters/[id]/wares` — Add Ware
- `DELETE /api/charters/[id]/wares/[wareId]` — Remove Ware
- `POST /api/charters/[id]/scheduled-tasks` — Add recurring schedule
- `PATCH /api/charters/[id]/scheduled-tasks/[id]` — Update schedule
- `DELETE /api/charters/[id]/scheduled-tasks/[id]` — Remove schedule
- `POST /api/charters/[id]/commissions` — Link a Commission
- `PATCH /api/charters/[id]/commissions/[id]` — Update allocation
- `DELETE /api/charters/[id]/commissions/[id]` — Unlink Commission
- `GET /api/charters/[id]/usage?period=2026-03` — Period usage breakdown
- Tests for all endpoints

### 5.2 Charter Recurring Task Generation
- `lib/services/charter-generator.ts` (parallel to maintenance-generator.ts)
- Follows same patterns: period calculation, idempotency via CharterGenerationLog
- Supports per-schedule cadences (weekly, monthly, quarterly, semi_annually, annually)
- Tasks created from SOPs with charter_id set
- Assigned to... TBD (Charter may need a default assignee, or tasks assigned based on SOP function)

### 5.3 Cron Integration
- `POST /api/cron/charter-tasks` — Cron endpoint for Charter task generation
- Runs daily alongside maintenance generation
- Same CRON_SECRET security pattern
- Generates tasks for all active Charters with due schedules

### 5.4 Charter UI
- Charters list screen (`/charters`)
- Charter detail with tabs:
  - Current Period (obligations, recurring tasks, one-offs, related commissions, usage)
  - Schedule (recurring task configuration)
  - Wares (active services, historical)
  - Archive (completed commissions, past period summaries)
  - Contract (links to originating Accord/Contract/Addendums)
- Add to Foundry nav

### 5.5 Client Detail Updates
- Add Accords tab to client detail
- Add Charters tab to client detail
- Show active Charters with usage summary

### 5.6 Charter Budget Tracking
- Period-based usage calculation (mirrors retainer tracking pattern)
- Hours from: recurring tasks + one-off tasks + allocated Commission tasks
- Progress bar on Charter detail and client detail
- Alerts when usage approaching limit (extend retainer alert cron)

### 5.7 Commission Completion → Charter Archive
- When a Commission transitions to `done`:
  - Check for CharterCommission links
  - Set `is_active = false`, `completed_at = now()`
  - Moves to Archive tab on Charter detail

**Phase 5 exit criteria:**
- [ ] Charter CRUD fully functional
- [ ] Recurring task generation working on cron
- [ ] Mixed cadences supported (monthly + quarterly in same Charter)
- [ ] Budget tracking accurate
- [ ] Commission ↔ Charter linking works
- [ ] Client detail shows Accords and Charters
- [ ] All tests pass

---

## Phase 6: Automation & Addendums

**Goal:** Sales automation rules, scope change guardrails, addendum flow.

**Dependencies:** Phase 5 complete

### 6.1 Sales Automation Engine
- `lib/services/sales-automation.ts`
- Processes two trigger types:
  - **Status change:** When Accord status changes, check matching rules, create tasks
  - **Time at status:** Cron checks `entered_current_status_at`, creates tasks when threshold exceeded
- Task creation uses rule's task_template (title, description, priority, energy, assignee)
- Assignee resolution: accord_owner, meeting_attendees, specific_user
- Tasks linked to Accord via `accord_id` on Task

### 6.2 Meeting Transcript Rule (Built-in)
- Hard-coded rule: 24h after meeting_date, if no transcript_url, create task for each attendee
- Runs as part of cron check

### 6.3 Automation Cron
- `POST /api/cron/sales-automation` — Daily cron for time-based rules
- Checks all non-terminal Accords against active SalesAutomationRules
- Idempotency: track which rules have fired for which Accords (may need a SalesAutomationLog table)

### 6.4 Automation Settings UI
- Automation rules management in Parley Settings
- Create/edit/delete rules
- Active toggle
- Preview: "This rule will create a task when an Accord has been at [status] for [X] hours"

### 6.5 Scope Change Guardrail
- Intercept task creation on scope-locked Commissions
- Frontend: modal with Prepare Addendum / Override / Cancel
- Backend: `POST /api/projects/[id]/scope-check` — validates scope_locked status
- Override: creates Addendum with `is_override = true`, logs reason
- Prepare Addendum: creates draft Addendum on related Accord

### 6.6 Addendum API
- `POST /api/accords/[id]/addendums` — Create
- `GET /api/accords/[id]/addendums` — List
- `GET /api/accords/[id]/addendums/[id]` — Detail
- `PATCH /api/accords/[id]/addendums/[id]` — Update draft (add/remove tasks, modify pricing)
- `POST /api/accords/[id]/addendums/[id]/send` — Generate token, send email
- Tests

### 6.7 Addendum UI (Internal)
- Addendums tab on Accord detail
- Create addendum flow:
  - Title, description
  - Add/remove line items (with pricing impact shown)
  - Add tasks to batch (for scope changes that include multiple tasks)
  - Contract language auto-generated from changes
  - Preview as client
  - Send

### 6.8 Addendum Portal (Client-Facing)
- `/portal/addendum/[token]`
- Shows what's changing, pricing impact
- Accept / Request Changes / Reject
- On accept: apply changes to Accord line items, update Charter/Commission as needed

**Phase 6 exit criteria:**
- [ ] Automation rules configurable and executing
- [ ] Time-based and status-change triggers both working
- [ ] Meeting transcript auto-task works
- [ ] Scope change guardrail prompts on locked Commissions
- [ ] Addendum full lifecycle: create, batch tasks, send, client accepts, changes applied
- [ ] All tests pass

---

## Future Phases (Designed For, Not Built Yet)

### Phase 7: QuickBooks Integration
- OAuth connection to QB
- Invoice generation on payment gate
- Recurring payment creation for Charters
- Payment webhook → auto-confirm payment on Accord
- Re-authorization flow when recurring payment changes
- Payment status sync

### Phase 8: Vacation Mode
- User can set vacation dates
- Accord ownership temporarily delegates to specified user
- Notifications route to delegate
- Auto-reverts after vacation end date

### Phase 9: Sales Analytics
- Pipeline conversion rates
- Average time at each stage
- Win/loss ratio
- Revenue forecasting from pipeline
- Charter revenue tracking

### Phase 10: Proposal Builder (Embedded)
- Replace local proposal generation with in-Citadel builder
- Template system for proposal sections
- Auto-populate from project scope (tasks → summary)
- Meeting transcript → AI-generated draft
- Version comparison (diff view)

---

## Cross-Cutting Concerns (Every Phase)

### Testing Requirements
- **Unit tests** for all new API endpoints (Vitest)
- **Unit tests** for all new calculation/service modules
- **Component tests** for new UI components
- **All existing tests must pass** at every merge point
- Sub-agents verify test passage before phase completion

### Activity Logging
- All new entities log create/update/delete/status_change to ActivityLog
- Uses existing `lib/services/activity.ts` patterns

### API Registry
- Every new endpoint registered in `lib/api/registry/`
- Registry stays current throughout build

### Accessibility
- All new UI follows existing accessibility patterns
- Keyboard navigation for kanban
- Screen reader support for portal pages

### Security
- Portal tokens: cryptographically random, 128 chars, hashed in DB
- Token expiry: 60 days (configurable)
- All signer data (IP, user agent) logged immutably
- Content snapshots taken at signing (what they agreed to can't be changed after)
- Rate limiting on portal endpoints
- CSRF protection on portal form submissions

### Error Handling
- All new APIs use existing ApiError/handleApiError patterns
- Graceful degradation on email send failures (log, don't block)
- Contract generation failures don't lose data (draft state preserved)

---

## Dependency Map

```
Phase 1 (Foundation)
  │
  ▼
Phase 2 (Wares & Accords CRUD)
  │
  ├── SendGrid Setup (parallel)
  │
  ▼
Phase 3 (Proposals & MSA) ◄── SendGrid
  │
  ▼
Phase 4 (Contracts & Signing)
  │
  ▼
Phase 5 (Charters / Retainers)
  │
  ▼
Phase 6 (Automation & Addendums)
  │
  ▼
Future: Phase 7 (QB), Phase 8 (Vacation), Phase 9 (Analytics), Phase 10 (Proposal Builder)
```

**SendGrid can be set up in parallel with Phase 2** since it's needed by Phase 3.
