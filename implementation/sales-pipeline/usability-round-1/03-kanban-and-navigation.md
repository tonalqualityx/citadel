# Kanban & Navigation Fixes

## Overview

Three issues: the pipeline kanban will become unusably long, MSA management and automation rules are buried in user settings, and there's no way to browse all Accords with filters.

---

## Problem 1: Kanban Too Long

### Current State
The kanban at `/deals` shows 6 columns: Lead → Meeting → Proposal → Contract → Signed → Active. The Active column will accumulate indefinitely. Signed will also grow.

### Fix

**Reduce kanban to active pipeline stages only:**
```
Lead | Meeting | Proposal | Contract | Signed
```

- Remove the **Active** column from the kanban entirely
- **Signed** column shows Accords awaiting payment confirmation only — once payment is confirmed and Accord moves to `active`, it disappears from the kanban
- Lost deals are not shown on the kanban (already the case)

**The kanban becomes a "what needs attention" view, not a historical record.**

### All Accords List View

Add a **list/table view toggle** on the deals page, or a separate route.

**Option A — Toggle on the same page:**
- Icon toggle in the top-right: kanban view / list view
- Persist preference (localStorage or user preference)

**Option B — Separate route:**
- `/deals` = kanban (active pipeline)
- `/deals/all` = full list view

**Recommendation:** Option A — same page, toggle view. Simpler nav.

**List view features:**
- Table with columns: Name, Client, Status, Total Value, Owner, Days at Status, Created Date
- Sortable columns
- Filters:
  - Status: multi-select (lead, meeting, proposal, contract, signed, active, lost)
  - Client: searchable dropdown
  - Owner: user dropdown
  - Date range (created_at)
  - Search by name
- Pagination
- Click row → navigate to Accord detail
- Default filter: exclude `lost` (show all active/completed)

---

## Problem 2: MSA Management in Wrong Location

### Current State
MSA version management (MsaVersionList + MsaEditor) is embedded in the user Settings page (`/settings`). This is a business-critical admin function, not a user preference.

### Fix
**Move MSA management to its own screen under Parley.**

#### New Route: `/deals/msa`

**Page content:**
- Current MSA version highlighted at top (green badge, content preview)
- Version history list below:
  - Version number, effective date, change summary, signature count, creator
  - "Current" badge on active version
  - Click → view/edit
- "New Version" button
- Edit view: full-page editor with BlockNote for MSA content (not a modal — this is long-form legal text)
- Client signature tracking: expandable section showing which clients have signed which version

#### Navigation
Add to Parley section in sidebar:
```
Parley:
  Accords (Deals)
  Meetings
  Wares (Products)
  MSA                ← NEW
  Automation         ← NEW
```

#### Cleanup
- Remove MSA section from `/settings` page
- Remove MsaVersionList and MsaEditor imports from settings
- Settings page should only contain user preferences (naming, theme, notifications, API keys)

---

## Problem 3: Automation Rules in Wrong Location

### Current State
Sales automation rules (AutomationRuleList + AutomationRuleForm) are embedded in the user Settings page.

### Fix
**Move automation rules to their own screen under Parley.**

#### New Route: `/deals/automation`

**Page content:**
- List of all SalesAutomationRules
- Each rule shows: name, trigger description, assignee rule, active toggle
- Create/edit via modal or inline form (these are shorter than MSA content, modal is fine)
- Active/inactive toggle per rule
- Delete with confirmation
- Preview text: "When an accord reaches [status] / has been at [status] for [X hours], create a task assigned to [rule] with title '[title]'"

#### Navigation
Under Parley section as shown above.

#### Cleanup
- Remove automation rules section from `/settings` page
- Remove AutomationRuleList and AutomationRuleForm imports from settings

---

## Updated Sidebar Structure

```
Parley (PM/Admin only):
  📋 Accords (Deals)
  🤝 Meetings (NEW)
  📦 Wares (Products)
  📄 MSA (MOVED from Settings)
  ⚡ Automation (MOVED from Settings)
```

---

## Implementation Checklist

### Files to Modify
- [ ] `/app/(app)/deals/page.tsx` — Remove Active column from kanban, add list/kanban view toggle
- [ ] `/app/(app)/settings/page.tsx` — Remove MSA and Automation sections
- [ ] `/components/layout/Sidebar.tsx` — Add Meetings, MSA, and Automation nav items under Parley

### Files to Create
- [ ] `/app/(app)/deals/msa/page.tsx` — MSA management screen
- [ ] `/app/(app)/deals/automation/page.tsx` — Automation rules screen
- [ ] `/app/(app)/meetings/page.tsx` — Meetings list (from 01-meetings-entity.md)
- [ ] `/app/(app)/meetings/[id]/page.tsx` — Meeting detail (from 01-meetings-entity.md)
- [ ] List view component for Accords (DataTable with filters)

### Files to Move/Refactor
- [ ] MSA components stay in `/components/domain/msa/` — just re-imported by new page
- [ ] Automation components stay in `/components/domain/automation/` (or wherever they are) — re-imported by new page

### Tests
- [ ] Kanban renders without Active column
- [ ] List view renders with proper filters
- [ ] MSA page loads and CRUD works
- [ ] Automation page loads and CRUD works
- [ ] Settings page no longer shows MSA or Automation sections
- [ ] All existing tests pass
