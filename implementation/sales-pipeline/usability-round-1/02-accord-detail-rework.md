# Accord Detail Rework

## Overview

The Accord detail page needs several fixes: tabs are hidden by status (confusing UX), the contracts tab has no content viewer, there's no tasks tab, and the meeting tab needs to be replaced with the new Meeting entity integration.

---

## Problem 1: Tabs Hidden by Status

### Current Behavior
Tabs are conditionally rendered based on `STATUS_ORDER.indexOf(accord.status)`:
- Overview: always
- Meeting: status >= `meeting`
- Proposals: status >= `proposal`
- Contracts: status >= `contract`
- Addendums: status >= `signed`

If an Accord is at `lead`, the user only sees Overview with no indication that other tabs exist.

### Fix
**Show all tabs always. Disable tabs that aren't yet relevant and show a helpful empty state when clicked.**

```
Tab behavior:
- Overview: always active
- Meetings: always active (can schedule meetings at any stage)
- Proposals: active at `proposal` or later; before that, show empty state: "Move this accord to the proposal stage to create proposals."
- Contracts: active at `contract` or later; before that, show empty state: "A contract will be generated when the client accepts a proposal."
- Tasks: always active (sales tasks can exist at any stage)
- Addendums: active at `signed` or later; before that, show empty state: "Addendums can be created after the accord is signed."
```

This way the user always sees the full lifecycle shape of an Accord and knows what's coming.

---

## Problem 2: No Contract Content Viewer

### Current Behavior
The Contracts tab (lines 759-851 of `deals/[id]/page.tsx`) shows a list with:
- Version number, date, MSA reference, status badge
- Send/Delete buttons for drafts
- Signer name/date for signed contracts
- No way to read the actual contract content

### Fix
**Add a contract viewer/editor inline on the Contracts tab.**

When a contract is clicked or a "View" button is clicked:
- Show the full contract content rendered via BlockNote/RichTextRenderer
- Show the pricing table from the pricing snapshot
- Show MSA version reference with link to view MSA content
- For draft contracts: allow editing content before sending (BlockNote editor)
- For sent/signed contracts: read-only view
- "Preview as Client" button opens the portal view in a new tab
- Back button returns to the contract list

**Implementation pattern:** Same as the Proposals tab — `ProposalVersionList` / `ProposalEditor` / `ProposalPreview` pattern. Create `ContractViewer` and `ContractEditor` components.

### Contract Content Must Use BlockNote
Currently contract content is stored as HTML text. It should use BlockNote JSON format (same as proposals and MSA) for consistency and rich editing. If existing contracts have HTML content, the viewer should handle both formats during transition.

---

## Problem 3: No Tasks Tab

### Current State
There is no tasks tab on the Accord detail page. The `accord_id` field exists on the Task model but there's no UI to view or create tasks linked to an Accord.

### Fix
**Add a Tasks tab, always visible regardless of Accord status.**

#### Tasks Tab Content:
- List of all tasks where `accord_id` = this Accord's id
- Includes manually created tasks AND auto-generated tasks from automation rules
- Standard task list display: title, status, assignee, priority, due date, energy estimate

#### Create Task from Accord:
- "New Task" button on the tab
- Auto-sets: `accord_id` = this Accord
- Does NOT auto-set `client_id` — the Accord may not have a client yet at lead stage
- If Accord has a client, auto-set `client_id` as well
- Standard task creation fields
- These are sales process tasks (follow-ups, prep work, etc.), not project deliverables

#### Task Side Peek:
- Clicking a task opens the existing TaskPeekDrawer
- All standard task actions available from peek

---

## Problem 4: Meeting Tab Replacement

### Current State
The Meeting tab has inline fields for meeting_date, meeting_notes, transcript_url, recording_url, and an attendees list. This is being replaced by the Meeting entity (see `01-meetings-entity.md`).

### Fix
**Replace the Meeting tab with a Meetings tab that shows associated Meeting entities.**

#### New Meetings Tab:
- List of meetings linked to this Accord (via MeetingAccord join table)
- Each row: title, date, team attendees (avatar stack), client attendees, summary preview, missing items indicator
- Click opens Meeting side peek (editable)
- "Open Full Screen" option navigates to `/meetings/[id]`
- "New Meeting" button:
  - If Accord has a client: auto-sets client + Accord association
  - If Accord has no client: triggers client creation/selection flow (see `01-meetings-entity.md`), then creates meeting
  - Adding a meeting to a `lead`-status Accord auto-advances to `meeting`

---

## Updated Tab Order

```
Overview | Meetings | Tasks | Proposals | Contracts | Addendums
```

Rationale: Meetings and Tasks are relevant at every stage. Proposals, Contracts, and Addendums follow the pipeline progression.

---

## Implementation Checklist

### Files to Modify
- [ ] `/app/(app)/deals/[id]/page.tsx` — Remove conditional tab rendering, add Tasks and Meetings tabs, replace Meeting tab, add contract viewer
- [ ] Remove all meeting-related state/handlers from Accord detail (meetingDate, meetingNotes, transcriptUrl, recordingUrl, handleSaveMeeting)
- [ ] Remove `useAddMeetingAttendee` / `useDeleteMeetingAttendee` imports

### Files to Create
- [ ] `/components/domain/contracts/ContractViewer.tsx` — Read-only contract content display
- [ ] `/components/domain/contracts/ContractEditor.tsx` — Draft contract editing with BlockNote
- [ ] `/components/domain/meetings/MeetingList.tsx` — Reusable meeting list for tabs
- [ ] `/components/domain/meetings/MeetingPeekDrawer.tsx` — Side peek for meetings
- [ ] `/components/domain/meetings/MeetingForm.tsx` — Meeting creation/editing

### API Changes
- [ ] `GET /api/accords/[id]/contracts/[contractId]` — Must return full content (verify it does)
- [ ] `PATCH /api/accords/[id]/contracts/[contractId]` — Must support content editing for drafts
- [ ] Contract content storage should support BlockNote JSON format

### Hooks to Create/Modify
- [ ] `useMeetings(filters)` — include accordId filter
- [ ] `useCreateMeeting()` — with auto-association
- [ ] Verify `useContracts` returns content field in response

### Tests
- [ ] Accord detail renders all tabs regardless of status
- [ ] Contract viewer displays content correctly
- [ ] Tasks tab shows tasks linked to Accord
- [ ] Meeting creation from Accord auto-associates and auto-advances pipeline
- [ ] All existing Accord tests still pass
