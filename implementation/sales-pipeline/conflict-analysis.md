# Sales Pipeline — Conflict Analysis

**Date:** 2026-03-18

---

## 1. Pact/Commission Terminology

### Current State
The terminology system in `use-terminology.ts` maps `project` → `Pact` (awesome mode) and `projects` → `Pacts`. "Commission" will replace "Pact" as the awesome-mode name.

### Files with "Pact" References

**Terminology System:**
- `app/lib/hooks/use-terminology.ts` (lines 8-9): `project: { awesome: 'Pact' }`, `projects: { awesome: 'Pacts' }`

**Important:** The terminology is applied via the `t()` hook, so most UI components don't hardcode "Pact" — they use `t('project')` / `t('projects')`. The primary change is updating the TERMS object.

**Historical/Mockup Files (reference only, no code changes needed):**
- `implementation/mockups/pacts-projects/` (8 HTML files)
- `implementation/documentation/wireframes/indelible-wireframes-pact-patron-detail.md`

### Required Changes
1. Update `use-terminology.ts` TERMS object: `project.awesome` → `'Commission'`, `projects.awesome` → `'Commissions'`
2. Add new terms: `deal/deals`, `charter/charters`, `ware/wares`, `parley`, `newDeal`, `newRetainer`, `newProduct`
3. Search for any hardcoded "Pact" strings outside the terminology hook

### Impact: **Medium** — Primarily a single-file change, but all UI using `t('project')` will reflect it.

---

## 2. Retainer Logic

### Current System (Stays As-Is)

**Core calculation:** `app/lib/calculations/retainer.ts` (117 lines)
- `getRetainerStatus(clientId, periodStart, periodEnd)` → RetainerStatus (allocatedHours, usedHours, remainingHours, percentUsed, status)
- `getAllRetainerStatuses(periodStart, periodEnd)` — Batch fetch
- Status thresholds: healthy (0-75%), warning (75-90%), critical (90-100%), exceeded (>100%)

**API endpoint:** `app/app/api/clients/[id]/retainer/route.ts` (576 lines)
- GET `/api/clients/{id}/retainer?month=YYYY-MM`
- Returns: actual usage, scheduled usage, unscheduled usage
- Retainer work detection: explicit `is_retainer_work: true`, or project `is_retainer: true`

**Prisma schema fields (Client):**
- `retainer_hours: Decimal(5,2)?`
- `hourly_rate: Decimal(10,2)?`
- `retainer_usage_mode: RetainerUsageMode` (enum: low/medium/high/actual)

**Prisma schema fields (Project):**
- `is_retainer: Boolean @default(false)`

**Prisma schema fields (Task):**
- `is_retainer_work: Boolean @default(false)`
- `is_support: Boolean @default(false)`
- `billing_amount: Decimal(10,2)?`
- `waive_overage: Boolean @default(false)`

**UI Components:**
- `app/components/domain/clients/client-retainer-tab.tsx` (~300 lines)
- `app/components/domain/billing/retainer-summary.tsx`
- `app/app/(app)/time/retainers/page.tsx`

**Cron/Reports:**
- `app/app/api/reports/retainers/route.ts`
- `app/app/api/reports/retainers/[clientId]/route.ts`
- `app/app/api/cron/retainer-alerts/route.ts`

### Coexistence with Charter System
Per data model doc: "Existing `retainer_hours` and `hourly_rate` fields on Client remain for now. Migration to Charter model is future work documented separately."

**No breaking changes.** Charter system is additive. Existing retainer system continues operating.

### Impact: **Low** — No conflicts. Systems coexist.

---

## 3. Status Transition Logic

### Existing System

**File:** `app/lib/calculations/status.ts` (149 lines)

**Project transitions:**
```
quote → [queue, cancelled]
queue → [ready, quote, suspended, cancelled]
ready → [in_progress, queue, suspended, cancelled]
in_progress → [review, ready, suspended, cancelled]
review → [done, in_progress, suspended]
done → [in_progress]
suspended → [queue, ready, in_progress, cancelled]
cancelled → [] (terminal)
```

**Task transitions:**
```
not_started → [in_progress, done, blocked, abandoned]
in_progress → [done, not_started, blocked, abandoned, review]
review → [done, in_progress, abandoned]
done → [in_progress, not_started]
blocked → [not_started, in_progress, done, abandoned]
abandoned → [not_started, in_progress]
```

**Helper functions:** `canTransitionTaskStatus()`, `getValidNextTaskStatuses()`, `canTransitionProjectStatus()`, `getValidNextProjectStatuses()`, `isTaskVisibleToAssignee()`

### New Code Needed
Create `app/lib/calculations/accord-status.ts` following the same pattern:
```
lead → [meeting, lost]
meeting → [proposal, lost]
proposal → [contract, lost]  // contract auto on acceptance
contract → [signed, lost]    // signed auto on signing
signed → [active]            // active on payment confirmation
active → []                  // terminal for pipeline
lost → [lead]                // reopen
```

Also need: `ProposalStatus`, `ContractStatus`, `AddendumStatus`, `CharterStatus` transition helpers.

### Impact: **Low** — New file, no changes to existing.

---

## 4. Navigation/Sidebar

### Current Structure

**File:** `app/components/layout/Sidebar.tsx` (222 lines)

**Sections:**
```
Main Nav: Dashboard, Timekeeper
Foundry (🔥): Projects, Clients, Sites, Domains, Tasks, Tools
Grimoire (📖): SOPs, Recipes
Settings (⚙️): solo item
Admin (🔐, PM/Admin only): Billing, Team, Functions, Hosting Plans, Maintenance, Integrations, Database, Reports, Settings
```

**Key details:**
- Uses `useTerminology()` hook for labels (line 92)
- Role-based: `isPmOrAdmin`, `isTech` checks (line 93)
- `NavItem` interface: `{ name, href, emoji }`
- `NavSection` interface: `{ title, emoji, items, defaultOpen }`
- `CollapsibleSection` component (lines 43-87)

### Required Changes
1. Add **Parley** section after Grimoire, before Settings (PM/Admin only):
   - Accords (`/deals`)
   - Wares (`/deals/wares`)
2. Add **Charters** to Foundry section (between Clients and Sites, or after Sites)
3. Add **Parley Settings** to Admin section
4. Rename "Projects" label if terminology changes (handled by `t()` hook)

### Impact: **Low** — Simple array additions.

---

## 5. Query Key Patterns

### Current Pattern

**File:** `app/lib/api/query-keys.ts` (175 lines)

**Example:**
```typescript
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters) => [...projectKeys.lists(), filters] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
  byClient: (clientId: string) => [...projectKeys.all, 'byClient', clientId] as const,
  bySite: (siteId: string) => [...projectKeys.all, 'bySite', siteId] as const,
  team: (id: string) => [...projectKeys.all, 'team', id] as const,
};
```

### New Keys Needed
- `accordKeys` — lists, detail, byClient, byStatus, byOwner
- `wareKeys` — lists, detail, byType
- `charterKeys` — lists, detail, byClient, byStatus, scheduledTasks, usage
- `proposalKeys` — byAccord, detail
- `contractKeys` — byAccord, detail
- `addendumKeys` — byAccord, detail
- `msaKeys` — versions, current, clientStatus

### Impact: **Low** — Purely additive.

---

## 6. API Registry

### Current Structure

**Location:** `app/lib/api/registry/` (14 domain files)

**Pattern:** Domain files export `ApiEndpoint[]`, index.ts consolidates.

**Existing files:** clients.ts, projects.ts, tasks.ts, billing.ts, sites.ts, domains.ts, sops.ts, recipes.ts, functions.ts, time.ts, comments.ts, milestones.ts, check-in.ts, reports.ts

### New Registry Files Needed
1. `app/lib/api/registry/accords.ts` — Accord CRUD, line items, meeting attendees, status transitions
2. `app/lib/api/registry/wares.ts` — Ware CRUD
3. `app/lib/api/registry/proposals.ts` — Proposal CRUD, send, portal
4. `app/lib/api/registry/contracts.ts` — Contract CRUD, send, portal, PDF
5. `app/lib/api/registry/charters.ts` — Charter CRUD, wares, scheduled tasks, commissions, usage
6. `app/lib/api/registry/msa.ts` — MSA versions, client signatures
7. `app/lib/api/registry/addendums.ts` — Addendum CRUD, send, portal
8. `app/lib/api/registry/portal.ts` — Portal session logging (or merge into individual entity registries)

Update `app/lib/api/registry/index.ts` to import and spread new domain files.

### Impact: **Low** — Additive.

---

## 7. Routing Structure

### Current Routes (`app/app/(app)/`)
```
/dashboard, /time, /time/reports, /time/retainers
/projects, /projects/new, /projects/[id]
/clients, /clients/[id]
/sites, /sites/[id]
/domains, /domains/[id]
/tasks, /tasks/[id]
/tools
/sops, /sops/new, /sops/[id], /sops/[id]/edit
/recipes, /recipes/[id]
/settings, /settings/notifications, /settings/api-keys, /settings/reports
/admin/* (team, functions, hosting-plans, maintenance-plans, integrations, database, settings)
/billing
```

### New Routes Needed
```
Internal (under app/(app)/):
  /deals                    — Accords kanban/list
  /deals/new                — New Accord
  /deals/[id]               — Accord detail
  /deals/wares              — Wares catalog
  /deals/wares/[id]         — Ware detail (or modal)
  /charters                 — Charters list
  /charters/[id]            — Charter detail
  /admin/parley-settings    — Parley settings (MSA, automation rules)

Portal (under app/portal/ — separate layout, no auth):
  /portal/proposal/[token]  — Client proposal view
  /portal/contract/[token]  — Client contract signing
  /portal/addendum/[token]  — Client addendum view
  /portal/msa/[token]       — MSA signing
  /portal/onboard/[token]   — Lead onboarding after signing
```

### Potential Conflict: **None** — All new route paths.

---

## 8. Hooks Needing Modification

### Terminology Hook
**File:** `app/lib/hooks/use-terminology.ts` (79 lines)
- **Change:** Update TERMS object with new entries (deal, deals, charter, charters, ware, wares, parley, newDeal, newRetainer, newProduct)
- **Change:** Update project awesome from 'Pact' to 'Commission', projects from 'Pacts' to 'Commissions'

### Client Hooks
**File:** `app/lib/hooks/use-clients.ts`
- **Change:** Add `accords` and `charters` to ClientWithRelations interface (when client detail includes these tabs)

### Project Hooks
**File:** `app/lib/hooks/use-projects.ts`
- **Change:** Add `accord_id`, `scope_locked`, `scope_locked_at` to Project interface

### New Hooks Needed
- `app/lib/hooks/use-accords.ts` — useAccords, useAccord, useCreateAccord, useUpdateAccord, useDeleteAccord, useAccordStatus, useAccordLineItems
- `app/lib/hooks/use-wares.ts` — useWares, useWare, useCreateWare, useUpdateWare
- `app/lib/hooks/use-charters.ts` — useCharters, useCharter, useCreateCharter, useUpdateCharter, useCharterUsage
- `app/lib/hooks/use-proposals.ts` — useProposals, useProposal, useCreateProposal, useSendProposal
- `app/lib/hooks/use-contracts.ts` — useContracts, useContract, useSendContract
- `app/lib/hooks/use-addendums.ts` — useAddendums, useAddendum, useCreateAddendum, useSendAddendum
- `app/lib/hooks/use-msa.ts` — useMsaVersions, useCurrentMsa, useClientMsaStatus

---

## 9. Prisma Schema Modifications

### Existing Models to Modify

**Project model** — Add:
- `accord_id String? @db.Uuid` (FK → Accord)
- `scope_locked Boolean @default(false)`
- `scope_locked_at DateTime?`
- Relation: `accord Accord? @relation(fields: [accord_id], references: [id])`

**Task model** — Add:
- `charter_id String? @db.Uuid` (FK → Charter)
- `accord_id String? @db.Uuid` (FK → Accord)
- Relations to Charter and Accord

**Client model** — Add relations:
- `accords Accord[]`
- `charters Charter[]`
- `client_msa_signatures ClientMsaSignature[]`

### New Enums (7)
AccordStatus, ProposalStatus, ContractStatus, AddendumStatus, WareType, CharterBillingPeriod, CharterStatus

### New Models (16)
Ware, Accord, AccordMeetingAttendee, AccordLineItem, Proposal, Contract, Addendum, MsaVersion, ClientMsaSignature, Charter, CharterWare, CharterScheduledTask, CharterGenerationLog, CharterCommission, PortalSession, SalesAutomationRule

### Impact: **High** — Largest single change. ~1500+ lines of schema additions.

---

## Summary

| Area | Severity | Type | Notes |
|------|----------|------|-------|
| Terminology (Pact → Commission) | Medium | Modify | Single file change, but UI-wide impact via t() hook |
| Retainer Logic | Low | Coexist | No changes — Charter system is additive |
| Status Transitions | Low | New | Create accord-status.ts, follow existing pattern |
| Navigation/Sidebar | Low | Modify | Add Parley section, Charters to Foundry |
| Query Keys | Low | Additive | 7+ new key factories |
| API Registry | Low | Additive | 5-8 new registry files |
| Routing | None | New | All new route paths, no conflicts |
| Hooks | Medium | Both | 1 modify (terminology), 7+ new hooks |
| Prisma Schema | High | Both | 3 models modified, 16 new models, 7 new enums |
