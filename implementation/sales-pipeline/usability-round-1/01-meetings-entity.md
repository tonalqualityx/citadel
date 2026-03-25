# Meetings — First-Class Entity

## Overview

Meetings are a top-level entity that can be associated with Clients, Accords, Projects, and Charters. They replace the meeting fields currently embedded on the Accord model. Meetings live under the Parley section in navigation, reflecting their role in relationship management and negotiation rather than day-to-day work.

---

## Data Model

### Meeting

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| title | varchar(255) | yes | Meeting name/subject |
| client_id | UUID (FK → Client) | yes | Always associated with a client |
| meeting_date | timestamp | yes | When the meeting is/was scheduled |
| summary | text (BlockNote JSON) | no | PM's synthesis — distilled decisions and key points |
| notes | text (BlockNote JSON) | no | Detailed meeting notes |
| transcript_url | varchar(500) | no | Link to transcript (Google Drive, etc.) |
| recording_url | varchar(500) | no | Link to video recording |
| client_attendees | text | no | Freeform text field for client-side attendee names |
| created_by_id | UUID (FK → User) | yes | Who created the meeting |
| is_deleted | boolean | yes | Default false |
| created_at | timestamp | auto | |
| updated_at | timestamp | auto | |

### MeetingAttendee (our team members)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| meeting_id | UUID (FK → Meeting) | yes | |
| user_id | UUID (FK → User) | yes | Citadel team member |
| created_at | timestamp | auto | |

**Unique constraint:** (meeting_id, user_id)

### MeetingAccord (many-to-many)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| meeting_id | UUID (FK → Meeting) | yes | |
| accord_id | UUID (FK → Accord) | yes | |
| created_at | timestamp | auto | |

**Unique constraint:** (meeting_id, accord_id)

### MeetingProject (many-to-many)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| meeting_id | UUID (FK → Meeting) | yes | |
| project_id | UUID (FK → Project) | yes | |
| created_at | timestamp | auto | |

**Unique constraint:** (meeting_id, project_id)

### MeetingCharter (many-to-many)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | auto | Primary key |
| meeting_id | UUID (FK → Meeting) | yes | |
| charter_id | UUID (FK → Charter) | yes | |
| created_at | timestamp | auto | |

**Unique constraint:** (meeting_id, charter_id)

### Task Modifications

Add field:
| Field | Type | Description |
|-------|------|-------------|
| meeting_id | UUID (FK → Meeting), nullable | Task was created from this meeting |

---

## Terminology

| Standard | Awesome |
|----------|---------|
| Meeting | Meeting (same — "Parley" is already the section name, doubling it would be weird) |
| Meetings | Meetings |

---

## Navigation

Add under Parley section in sidebar:
```
Parley:
  Accords (Deals)
  Meetings (NEW)
  Wares (Products)
  MSA (NEW — moved from Settings, see 03-kanban-and-navigation.md)
  Automation (NEW — moved from Settings, see 03-kanban-and-navigation.md)
```

---

## Screens

### Meetings List — `/meetings`

**Table columns:**
- Title (linked to detail)
- Client name (linked)
- Date
- Team attendees (avatar stack)
- Associations (badges: Accord names, Project names, Charter names)
- Missing items indicator (if date is past and transcript/recording missing)

**Filters:**
- Client (searchable dropdown)
- Date range
- Associated Accord
- Search by title

**Alert banner:**
- "X meetings are missing transcript or recording" — clicking filters to those meetings
- Only counts meetings where: date is in the past AND (transcript_url is null OR recording_url is null)

### Meeting Detail — `/meetings/[id]`

**Full-page view with all meeting data. Also accessible as a side peek drawer from any meetings tab (same data, constrained width).**

**Header:**
- Title (editable inline)
- Client name (linked)
- Date
- Team attendees (avatars with add/remove)
- Client attendees (editable text field)

**Sections:**

#### Associations
- Linked Accords (chips/badges, can add/remove, searchable dropdown scoped to client)
- Linked Projects (chips/badges, can add/remove, searchable dropdown scoped to client's projects)
- Linked Charters (chips/badges, can add/remove, searchable dropdown scoped to client's charters)

#### Summary (BlockNote editor)
- PM's synthesis of the meeting
- Optional — can be left empty

#### Notes (BlockNote editor)
- Detailed meeting notes
- Optional

#### Links
- Transcript URL (input with external link button)
- Recording URL (input with external link button)

#### Tasks
- List of tasks created from this meeting (where task.meeting_id = this meeting)
- Create task button — opens inline form or modal:
  - Standard task fields (title, description, priority, energy, assignee, etc.)
  - Auto-set: `client_id` = meeting's client, `meeting_id` = this meeting
  - Dropdowns (all scoped to this client's open entities):
    - Accord (optional)
    - Project/Commission (optional)
    - Charter (optional)
  - If none selected: task is ad-hoc or support (existing `is_support` flag)
  - Task appears in all relevant tabs once created

### Side Peek (Drawer)

- Same content as full-page detail
- Uses the existing TaskPeekDrawer pattern (slide-in from right)
- All fields are editable from the peek — no need to go full screen
- "Open Full Screen" button to navigate to `/meetings/[id]`
- Triggered from any meetings tab on Accord/Client/Project/Charter detail

---

## Meetings Tab (on other entities)

Every entity that can be linked to a meeting gets a **Meetings tab**:

### On Accord Detail (`/deals/[id]`)
- Replaces the current "Meeting" tab (which has inline fields)
- Shows list of meetings linked to this Accord
- Each row: title, date, attendees, summary preview, missing items indicator
- Click opens side peek
- "New Meeting" button:
  - Auto-sets: client (from Accord's client), Accord association
  - If Accord has no client yet (still a lead): triggers client creation flow first (see below)

### On Client Detail (`/clients/[id]`)
- New tab showing ALL meetings for this client
- Sorted by date descending
- Same row format as above
- "New Meeting" button auto-sets client

### On Project Detail (`/projects/[id]`)
- New tab showing meetings linked to this project
- "New Meeting" button auto-sets client (from project) + project association

### On Charter Detail (`/charters/[id]`)
- New tab showing meetings linked to this charter
- "New Meeting" button auto-sets client (from charter) + charter association

---

## Accord Pipeline Automation

### Adding a Meeting → Auto-Advance to Meeting Stage

When a meeting is associated with an Accord that is at `lead` status:
1. Accord status automatically transitions to `meeting`
2. Activity log records the transition
3. Accord's `entered_current_status_at` updates

### Lead → Client Creation Flow

When adding a meeting to an Accord with no `client_id`:
1. Modal appears: "This accord has no client. Associate with an existing client or create a new one."
2. **Option A — Select existing client:** Searchable client dropdown
3. **Option B — Create new client:** Form pre-filled from Accord's lead fields (lead_name, lead_business_name, lead_email, lead_phone)
4. On submit: Client created/selected, linked to Accord, meeting gets client_id
5. Meeting is created, Accord advances to `meeting` status

---

## Overlook Integration

### Missing Meeting Items Indicator

**Who sees it:** Only team members who are attendees of the meeting (MeetingAttendee records).

**When it shows:** Meeting date is in the past AND (transcript_url is null OR recording_url is null).

**Display:** Similar to the existing "completed task with no time logged" pattern.
- Indicator card in the Overlook dashboard
- Shows count of meetings needing attention
- Each meeting listed with: title, date, client, what's missing (transcript/recording/both)
- Quick actions per meeting:
  - Open meeting (side peek or full screen)
  - "Mark as N/A" — dismisses the alert for this meeting (needs a flag: `transcript_not_available`, `recording_not_available` — booleans on Meeting)

### Additional Meeting Fields for N/A Dismissal

| Field | Type | Description |
|-------|------|-------------|
| transcript_not_available | boolean | Default false. True = stop alerting about missing transcript |
| recording_not_available | boolean | Default false. True = stop alerting about missing recording |

Alert condition becomes:
- Date is past AND
- (transcript_url is null AND transcript_not_available is false) OR
- (recording_url is null AND recording_not_available is false)

---

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/meetings` | List with pagination, filters | PM/Admin |
| POST | `/api/meetings` | Create meeting | PM/Admin |
| GET | `/api/meetings/[id]` | Meeting detail with all associations | PM/Admin |
| PATCH | `/api/meetings/[id]` | Update meeting | PM/Admin |
| DELETE | `/api/meetings/[id]` | Soft delete | PM/Admin |
| POST | `/api/meetings/[id]/attendees` | Add team attendee | PM/Admin |
| DELETE | `/api/meetings/[id]/attendees/[attendeeId]` | Remove attendee | PM/Admin |
| POST | `/api/meetings/[id]/accords` | Link to Accord | PM/Admin |
| DELETE | `/api/meetings/[id]/accords/[accordId]` | Unlink from Accord | PM/Admin |
| POST | `/api/meetings/[id]/projects` | Link to Project | PM/Admin |
| DELETE | `/api/meetings/[id]/projects/[projectId]` | Unlink from Project | PM/Admin |
| POST | `/api/meetings/[id]/charters` | Link to Charter | PM/Admin |
| DELETE | `/api/meetings/[id]/charters/[charterId]` | Unlink from Charter | PM/Admin |
| GET | `/api/meetings/incomplete` | Meetings missing transcript/recording for current user | Authenticated |
| POST | `/api/meetings/[id]/tasks` | Create task from meeting (auto-sets meeting_id + client_id) | PM/Admin |

---

## Business Rules

1. **Client is required.** A meeting cannot exist without a client association. If creating from an Accord with no client, client creation/selection must happen first.
2. **Multiple associations allowed.** A single meeting can link to multiple Accords, Projects, and Charters simultaneously.
3. **Meeting → Accord pipeline.** Associating a meeting with a `lead`-status Accord auto-advances to `meeting`.
4. **Tasks from meetings** always get `meeting_id` and `client_id`. Other associations (accord, project, charter) are optional and selected by the user.
5. **Missing items alert** only surfaces to team attendees of that meeting, not all PM/Admins.
6. **Soft delete** — meetings are never hard deleted.
7. **Activity logging** — creating, updating, associating, and dissociating meetings are all logged.

---

## Migration: Remove Legacy Meeting Fields from Accord

The following fields on the Accord model become redundant and should be removed:
- `meeting_date`
- `meeting_notes`
- `meeting_transcript_url`
- `meeting_recording_url`

The `AccordMeetingAttendee` model should also be dropped.

**Migration safety:** These fields have not been used in production. No data migration needed — just drop the columns and remove all code references.

**Code cleanup:**
- Remove meeting-related state and handlers from `/app/(app)/deals/[id]/page.tsx`
- Remove the inline Meeting tab content
- Replace with Meetings tab that queries MeetingAccord associations
- Remove meeting fields from Accord API update handler
- Remove meeting fields from Accord Zod validation schema
- Remove `useAddMeetingAttendee` and `useDeleteMeetingAttendee` hooks (or repurpose for Meeting entity)
- Update Accord formatter to exclude meeting fields
