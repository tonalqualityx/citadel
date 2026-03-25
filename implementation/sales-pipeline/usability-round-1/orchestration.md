# Usability Round 1 — Orchestration Guide

## Scope

This round addresses usability issues discovered after the initial Parley implementation. It introduces a new entity (Meetings), reworks the Accord detail page, fixes navigation/kanban issues, and resolves UX problems with Wares and Charters.

**This work is INDEPENDENT of and should be completed BEFORE Phases 7-9** (QuickBooks, Vacation Mode, Analytics) from the parent `03-phased-build-plan.md`.

---

## Planning Documents

Read in order:

| # | Document | What It Covers |
|---|----------|----------------|
| 1 | `01-meetings-entity.md` | New Meeting data model, screens, side peek, Overlook integration, Accord pipeline automation |
| 2 | `02-accord-detail-rework.md` | Tab visibility fix, contract viewer, tasks tab, meeting tab replacement |
| 3 | `03-kanban-and-navigation.md` | Kanban column cleanup, all-accords list view, MSA and automation moved from settings |
| 4 | `04-ware-and-charter-fixes.md` | Ware detail pages, BlockNote everywhere, Charter UUID fix, entity selector audit |

---

## Execution Order & Dependencies

```
Step 1: Meetings Entity (01)
  │  New data model, migration, API, hooks
  │  Creates: Meeting, MeetingAttendee, MeetingAccord, MeetingProject, MeetingCharter
  │  Modifies: Task (add meeting_id), Accord (remove legacy meeting fields)
  │
  ├─── Step 2a: Accord Detail Rework (02)          ─┐
  │      Depends on: Meetings entity existing         │
  │      Tab fixes, contract viewer, tasks tab,       │  Can run
  │      meetings tab replacement                     │  in parallel
  │                                                   │
  ├─── Step 2b: Kanban & Navigation (03)            ─┤
  │      Independent of meetings entity               │
  │      Kanban cleanup, MSA move, automation move    │
  │                                                   │
  └─── Step 2c: Ware & Charter Fixes (04)           ─┘
         Independent of meetings entity
         Ware detail pages, BlockNote, UUID fix
```

**Step 1 must complete before Step 2a begins.** Steps 2a, 2b, and 2c can run in parallel.

---

## Pre-Implementation (Same Pattern as Original Build)

Before writing code, dispatch sub-agents for:

### Sub-Agent A: Impact Analysis
- Search for all references to Accord meeting fields being removed (`meeting_date`, `meeting_notes`, `meeting_transcript_url`, `meeting_recording_url`, `AccordMeetingAttendee`)
- Search for all textarea fields that will become BlockNote editors
- Search for all raw UUID/ID inputs that need Combobox replacement
- Search for all imports of MSA/Automation components from Settings page
- Identify test files that reference any of the above
- Output: `usability-round-1/impact-analysis.md`

### Sub-Agent B: Component Inventory
- List all existing Combobox/searchable dropdown usages (for pattern reference)
- List all existing BlockNote/RichTextEditor usages (for pattern reference)
- List all existing side peek/drawer usages (for meeting peek pattern)
- Check if a reusable "entity meetings tab" component pattern exists
- Output: `usability-round-1/component-inventory.md`

### Sub-Agent C: Test Baseline
- Run all tests, document current state
- Flag any tests referencing Accord meeting fields
- Flag any tests referencing Settings page MSA/automation sections
- Output: `usability-round-1/test-baseline.md`

---

## Step 1: Meetings Entity

### Sub-tasks (sequential):

1. **Schema & Migration**
   - Create Meeting, MeetingAttendee, MeetingAccord, MeetingProject, MeetingCharter models
   - Add `meeting_id` to Task model
   - Add `transcript_not_available`, `recording_not_available` to Meeting
   - Remove from Accord: `meeting_date`, `meeting_notes`, `meeting_transcript_url`, `meeting_recording_url`
   - Drop AccordMeetingAttendee model
   - Generate and test migration

2. **API Routes**
   - CRUD for meetings
   - Association endpoints (link/unlink accords, projects, charters)
   - Attendee management
   - Task creation from meeting
   - Incomplete meetings endpoint (for Overlook)
   - All with Zod validation, formatters, error handling, activity logging

3. **Hooks & Query Keys**
   - `useMeetings(filters)`, `useMeeting(id)`, `useCreateMeeting()`, `useUpdateMeeting()`, `useDeleteMeeting()`
   - Association hooks
   - `useIncompleteMeetings()` for Overlook
   - Query key factory entries

4. **UI Components**
   - MeetingForm (creation modal + full edit)
   - MeetingList (reusable for tabs)
   - MeetingPeekDrawer (side peek, editable, with "Open Full Screen")
   - MeetingDetail (full page view)
   - ClientCreationModal (for lead → client conversion when adding meeting to clientless Accord)

5. **Pages & Navigation**
   - `/meetings` list page
   - `/meetings/[id]` detail page
   - Add Meetings to Parley sidebar section
   - Meetings tab on: Client detail, Accord detail, Project detail, Charter detail

6. **Overlook Integration**
   - Missing meeting items indicator for team attendees
   - Quick actions: open meeting, mark transcript/recording as N/A

7. **Accord Pipeline Automation**
   - Adding meeting to `lead` Accord → auto-advance to `meeting`
   - Lead → client creation flow when Accord has no client

8. **Cleanup**
   - Remove all legacy meeting code from Accord detail page
   - Remove meeting fields from Accord API handlers
   - Remove meeting fields from Accord Zod schemas
   - Remove AccordMeetingAttendee hooks
   - Update Accord formatter

9. **Tests**
   - All new API endpoints
   - Meeting creation with auto-association
   - Pipeline auto-advance
   - Client creation flow
   - Overlook incomplete meetings query
   - Verify no existing tests break

---

## Step 2a: Accord Detail Rework

### Sub-tasks:

1. **Show all tabs always**
   - Remove conditional rendering logic for tabs
   - Add empty states for tabs not yet relevant

2. **Contract viewer/editor**
   - ContractViewer component (BlockNote rendered content + pricing table)
   - ContractEditor component (BlockNote editor for draft content)
   - Click contract in list → show viewer/editor inline
   - Preview as client button

3. **Tasks tab**
   - Task list filtered by `accord_id`
   - Create task with auto-set `accord_id` (and `client_id` if available)
   - Standard task peek on click

4. **Tests**

---

## Step 2b: Kanban & Navigation

### Sub-tasks:

1. **Kanban cleanup**
   - Remove Active column
   - Signed column clears on payment confirmation

2. **List view toggle**
   - Table view with filters (status, client, owner, date, search)
   - Kanban/list toggle with persisted preference

3. **Move MSA to `/deals/msa`**
   - Create page, import existing components
   - Remove from Settings

4. **Move Automation to `/deals/automation`**
   - Create page, import existing components
   - Remove from Settings

5. **Sidebar updates**
   - Add Meetings, MSA, Automation to Parley section

6. **Tests**

---

## Step 2c: Ware & Charter Fixes

### Sub-tasks:

1. **Ware detail page**
   - `/deals/wares/[id]` with all sections
   - BlockNote for description and contract_language
   - Pricing tiers structured editor
   - Default schedule editor (Charter Wares)
   - Recipe selector (Commission Wares)

2. **Ware creation flow**
   - Minimal modal: Name + Type
   - "Create" and "Create & Open" buttons
   - List links to detail page

3. **BlockNote migration**
   - Addendum form: contract_content and description → BlockNote
   - Contract content → BlockNote
   - Handle existing HTML content gracefully

4. **Entity selector audit**
   - CharterForm: client UUID → Combobox
   - All other raw ID inputs → Combobox
   - Full audit per checklist in `04-ware-and-charter-fixes.md`

5. **Charter detail links**
   - Accord link clickable
   - Ware names link to detail
   - Commission names link to project detail

6. **Tests**

---

## Verification Checklist (After All Steps)

- [ ] All existing tests pass
- [ ] All new tests pass
- [ ] Meetings: create, edit, associate, peek, full screen, Overlook indicator
- [ ] Accord detail: all tabs visible, contract content readable/editable, tasks tab works
- [ ] Kanban: no Active column, signed clears on payment, list view toggles
- [ ] MSA management accessible at `/deals/msa`, removed from Settings
- [ ] Automation rules accessible at `/deals/automation`, removed from Settings
- [ ] Wares: detail page renders, "Create & Open" works, BlockNote editors save/load
- [ ] Charters: client selected via Combobox, not UUID input
- [ ] No raw UUID inputs anywhere in Parley/Charter forms
- [ ] No BlockNote content stored as plain text — all using JSON format
- [ ] Pipeline: adding meeting to lead Accord auto-advances to meeting
- [ ] Pipeline: lead Accord without client triggers client creation when adding meeting
- [ ] Sidebar: Meetings, MSA, Automation visible under Parley
- [ ] No console errors in browser

---

## Key Conventions

Same as the original build — reference the parent `orchestration.md` for:
- API error handling patterns
- Formatter patterns
- Auth middleware
- Zod validation
- React Query hooks
- Activity logging
- Toast notifications
- Component styling (CVA)
- Terminology system

---

## Risk Areas

| Risk | Mitigation |
|------|------------|
| Removing Accord meeting fields breaks existing data | Fields haven't been used — verify with DB query before migration |
| BlockNote migration for existing textarea content | Viewer handles both HTML and BlockNote JSON during transition |
| Multiple parallel steps editing sidebar | Steps 2a/2b/2c may all touch Sidebar.tsx — coordinate or serialize sidebar changes |
| Meeting peek drawer complexity | Follow existing TaskPeekDrawer pattern exactly |
| Entity selector audit scope | Use the checklist in doc 04 — don't let this expand beyond Parley/Charter forms |
