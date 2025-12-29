# Indelible App: Quest Detail View Wireframes
## Phase 2.3a Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** âœ… Complete

---

## Overview

The Quest Detail View is the most frequently visited screen in Indelible. This is where all team members—Techs, PMs, and Admins—work on their assigned tasks. The view is optimized for starting/stopping timers, tracking progress, and managing task details.

**Primary users:** Anyone assigned to a quest (Techs, PMs, Admins)

**Secondary users:** PMs reviewing work, Admins with oversight

---

## Entry Points

Users arrive at Quest Detail from:

- "What's Next?" recommendation on dashboard
- My Quests list
- A Pact's quest list
- Search results
- Notifications (assignment, status change, review request)
- Direct link/bookmark

---

## Page Structure

```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│ Breadcrumb: 👨‍🚀 Acme Corp â€º 🏰 Main Website â€º 💝 Website Redesign â€º âš”️ Homepage  │
├─────────────────────────────────────────────────────────────────────────────────â”¤
│                                                                                 │
│  PageHeader                                                                     │
│  âš”️ Homepage Mockup                                    [â–¶ Start Timer] [â‹®]     │
│     â— In Progress Â· ☑ 3~5 Â· 💤 Mike Hansen Â· 📦 Due Dec 22                     │
│                                                                                 │
├─────────────────────────────────────────────────────────────────────────────────â”¤
│                                                                                 │
│  [Overview]    Time    Notes    Activity                                        │
│  ──────────                                                                     │
│                                                                                 │
├───────────────────────────────────────────────────â”¬─────────────────────────────â”¤
│                                                   │                             │
│  MAIN CONTENT (left, ~65%)                        │  SIDEBAR (right, ~35%)      │
│                                                   │                             │
│  - Rune callout (if applicable)                   │  - Timer                    │
│  - Description                                    │  - Details (inc. Function)  │
│  - Requirements                                   │  - Time Summary             │
│  - Dependencies                                   │                             │
│                                                   │                             │
└───────────────────────────────────────────────────â”´─────────────────────────────â”˜
```

---

## Breadcrumbs

Full hierarchy showing context:

```
👨‍🚀 Acme Corp  â€º  🏰 Main Website  â€º  💝 Website Redesign  â€º  âš”️ Homepage Mockup
```

| Element | Behavior |
|---------|----------|
| Patron | Link to Patron detail |
| Site | Link to Site detail |
| Pact | Link to Pact detail |
| Quest | Current page (not linked) |

Uses Breadcrumbs component with entity icons.

---

## PageHeader

```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│                                                                                 │
│  âš”️  Homepage Mockup                              [â–¶ Start Timer]  [â‹® More]    │
│      â— In Progress Â· ☑ 3~5 Â· 💤 Mike Hansen Â· 📦 Due Dec 22                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────â”˜
```

### Meta Line Elements

| Element | Component | Display |
|---------|-----------|---------|
| Status | StatusChip | Colored dot + status text |
| Energy | EnergyBadge | ☑ + range (e.g., "3~5") |
| Assignee | Avatar + text | Initials circle + full name |
| Due Date | Icon + text | 📦 + formatted date |

Separator: " Â· " between each element

### Primary Action Button

The primary action changes based on quest and timer state:

| Quest Status | Timer State | Button Display | Style |
|--------------|-------------|----------------|-------|
| Ready | No timer | `â–¶ Start Timer` | Primary |
| Ready | Timer on OTHER quest | `â–¶ Start Timer` | Primary (prompts to switch) |
| In Progress | No timer | `â–¶ Start Timer` | Primary |
| In Progress | Timer on THIS quest | `â–  Stop Â· 1:23:45` | Warning (amber) |
| In Progress | Timer on OTHER quest | `â–¶ Start Timer` | Primary (prompts to switch) |
| In Review | Any | Hidden or disabled | — |
| Blocked | Any | `â–¶ Start Timer` | Disabled + tooltip |
| Done | Any | Hidden | — |

### More Menu (â‹®)

| Action | Availability |
|--------|--------------|
| Edit Quest | All users with edit permission |
| Duplicate | All users |
| Move to Pact... | PM, Admin |
| Archive | PM, Admin |
| Delete | Admin only (with confirmation) |

---

## Tabs

```
[Overview]    Time    Notes    Activity
──────────
```

| Tab | Content | Badge |
|-----|---------|-------|
| **Overview** | Description, subtasks, dependencies | — |
| **Time** | Time entries list, manual entry | Count if >0 |
| **Notes** | Threaded notes with attachments | Count if >0 |
| **Activity** | Audit log of all changes | — |

Default tab: **Overview**

---

## Overview Tab

Two-column layout with main content (left) and sidebar (right).

### Left Column: Main Content

#### Rune Callout (Conditional)

When the Quest was created from a Rune (SOP template), show a prominent callout:

```
â”Œ─────────────────────────────────────────────────────────────────â”
│                                                                 │
│  📜 Rune: Website Page Design                      [View Rune]  │
│     Step-by-step instructions for this task type                │
│                                                                 │
└─────────────────────────────────────────────────────────────────â”˜
```

| Element | Behavior |
|---------|----------|
| Icon | 📜 scroll icon |
| Title | Rune name, clickable link |
| Subtitle | Brief description of what the Rune covers |
| Action | [View Rune] opens Rune detail in drawer or new page |

**Not shown** when Quest has no associated Rune (custom/one-off tasks).

---

#### Description Section

```
â”Œ─────────────────────────────────────────────────────────────────â”
│                                                                 │
│  Description                                            [Edit]  │
│  ───────────────────────────────────────────────────────────────│
│                                                                 │
│  Create a mockup for the homepage redesign based on the         │
│  approved wireframes from the kickoff meeting.                  │
│                                                                 │
│  Key sections to include:                                       │
│  - Hero section with new value proposition                      │
│  - Updated navigation with dropdown menus                       │
│  - Featured products grid (3x2 layout)                          │
│  - Customer testimonials carousel                               │
│                                                                 │
│  Reference: [Figma Wireframes]                                  │
│                                                                 │
│  Note: Client requested brand blue (#2B5797) for hero           │
│  background instead of gray.                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────â”˜
```

| Property | Value |
|----------|-------|
| Content | Rich text with links, formatting, lists |
| Edit | Opens inline editor or modal |
| Empty state | "No description yet. [Add one]" |

Description is for context, notes, and reference links—not checklists.

---

#### Requirements Section

Simple checklist of items needed to complete the quest. These are not full tasks—just checkboxes populated from the Rune template (if applicable) or added manually.

```
â”Œ─────────────────────────────────────────────────────────────────â”
│                                                                 │
│  Requirements                                     [+ Add Item]  │
│  ───────────────────────────────────────────────────────────────│
│                                                                 │
│  â˜‘ Set up Figma project file                                    │
│  â˜‘ Import brand assets                                          │
│  â˜‘ Design hero section                                          │
│  â˜ Design navigation menus                                      │
│  â˜ Design product grid                                          │
│  â˜ Design testimonials section                                  │
│  â˜ Design footer                                                │
│  â˜ Internal review with PM                                      │
│                                                                 │
│  3 of 8 complete                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────â”˜
```

| Element | Behavior |
|---------|----------|
| Checkbox | Click to toggle complete |
| Item text | Click to edit inline |
| Drag handle | Reorder items (hidden until hover) |
| Delete | âœ• button on hover |
| Progress | "X of Y complete" summary |
| Add | [+ Add Item] creates new empty item at bottom |

**Source:** When Quest is created from a Rune, requirements are auto-populated from the Rune's template checklist. Users can add, edit, or remove items.

**Empty state:** "No requirements. [Add item]"

---

#### Dependencies Section

```
â”Œ─────────────────────────────────────────────────────────────────â”
│                                                                 │
│  Dependencies                                                   │
│  ───────────────────────────────────────────────────────────────│
│                                                                 │
│  🚫 Blocked by:                                                 │
│  â”Œ─────────────────────────────────────────────────────────â”    │
│  │ âš”️ Brand Guidelines Finalization       In Progress  💤JD │    │
│  │    Acme Corp â€º Branding                                 │    │
│  └─────────────────────────────────────────────────────────â”˜    │
│                                                                 │
│  📜 Blocking:                                                   │
│  â”Œ─────────────────────────────────────────────────────────â”    │
│  │ âš”️ Homepage Development                    Ready  💤MH  │    │
│  │    Acme Corp â€º Redesign                                 │    │
│  └─────────────────────────────────────────────────────────â”˜    │
│  â”Œ─────────────────────────────────────────────────────────â”    │
│  │ âš”️ Mobile Homepage Mockup                  Ready  💤MH  │    │
│  │    Acme Corp â€º Redesign                                 │    │
│  └─────────────────────────────────────────────────────────â”˜    │
│                                                                 │
│                                         [+ Add Dependency]      │
│                                                                 │
└─────────────────────────────────────────────────────────────────â”˜
```

| Subsection | Content |
|------------|---------|
| **Blocked by** | Quests that must complete before this one can start |
| **Blocking** | Quests waiting on this one to complete |

Each dependency displays as a QuestCard (flush variant) showing:
- Quest icon and name (link)
- Status chip
- Assignee avatar
- Breadcrumb context

**Empty state:** "No dependencies. Dependencies help track what must be done before or after this quest. [Add dependency]"

**Add dependency:** Opens EntitySelector filtered to quests within same Pact (or all quests with search).

---

### Right Column: Sidebar

#### Timer Section

```
â”Œ─────────────────────────────────────â”
│                                     │
│  Timer                              │
│  ─────────────────────────────────  │
│                                     │
│       â”Œ───────────────â”             │
│      â•±   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘   â•²            │
│     │                   │           │
│     │     1:47:32       │           │
│     │   Homepage Mo...  │           │
│     │                   │           │
│      â•²   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘   â•±            │
│       └───────────────â”˜             │
│                                     │
│  ☑ 3~5 estimate                    │
│  ─────────────────────────────────  │
│  Low    3h   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘  âœ“    │
│  High   5h   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘      │
│                                     │
│       [Pause]        [Stop]         │
│                                     │
└─────────────────────────────────────â”˜
```

Uses the full **TimerWidget** component as defined in the Component Library.

**States:**

| Timer State | Display |
|-------------|---------|
| Timer running on THIS quest | Full TimerWidget with progress |
| Timer running on OTHER quest | "Timer running on [Quest Name]" with link |
| No timer running | Empty state with [â–¶ Start Timer] button |

---

#### Details Section

```
â”Œ─────────────────────────────────────â”
│                                     │
│  Details                            │
│  ─────────────────────────────────  │
│                                     │
│  Status        [In Progress ▼]      │
│  Priority      [High ▼]             │
│  Function      💤 Designer II       │
│  Assignee      [💤 Mike Hansen ▼]   │
│  Due Date      [Dec 22, 2024 📦]    │
│  Energy        ☑ 3~5 [Edit]        │
│  Phase         Design               │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  Rune          📜 Website Page...   │
│  Pact          💝 Website Redesign  │
│  Site          🏰 Main Website      │
│  Patron        👨‍🚀 Acme Corp         │
│                                     │
└─────────────────────────────────────â”˜
```

**Editable Fields:**

| Field | Control | Notes |
|-------|---------|-------|
| Status | Select dropdown | Options based on current status |
| Priority | Select dropdown | Critical, High, Medium, Low |
| Function | Select dropdown | Role/skill level required (Designer II, Developer III, etc.) |
| Assignee | EntitySelector | Team members |
| Due Date | DatePicker | Optional |
| Energy | Edit link → Modal | Base estimate + mystery factor |
| Phase | Read-only | Inherited from Pact phase structure |

**Context Fields (read-only links):**

| Field | Display |
|-------|---------|
| Rune | Icon + name, links to Rune detail (hidden if no Rune) |
| Pact | Icon + name, links to Pact detail |
| Site | Icon + name, links to Site detail |
| Patron | Icon + name, links to Patron detail |

---

#### Time Summary Section

```
â”Œ─────────────────────────────────────â”
│                                     │
│  Time Summary                       │
│  ─────────────────────────────────  │
│                                     │
│  Logged       4h 30m                │
│  Estimate     3~5h                  │
│  Remaining    ~30m to high          │
│                                     │
│  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘  (90%)        │
│                                     │
└─────────────────────────────────────â”˜
```

| Field | Value |
|-------|-------|
| Logged | Total time from all entries |
| Estimate | Energy range |
| Remaining | Time until high estimate |
| Progress bar | Visual progress toward estimate |

**Progress bar states:**

| Logged vs Estimate | Bar Color | Text |
|--------------------|-----------|------|
| Under low estimate | Accent blue | "Within estimate" |
| Between low and high | Amber | "In mystery zone" |
| Over high estimate | Amber | "Over by X:XX" |

---

## Time Tab

```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│                                                                                 │
│  Time Entries                                            [+ Add Manual Entry]   │
│  ───────────────────────────────────────────────────────────────────────────────│
│                                                                                 │
│  Today Â· Dec 20                                                                 │
│  â”Œ─────────────────────────────────────────────────────────────────────────â”    │
│  │  1:23:45    9:00 AM – 10:24 AM    Timer    💤 Mike Hansen    [Edit][âœ•]  │    │
│  └─────────────────────────────────────────────────────────────────────────â”˜    │
│                                                                                 │
│  Yesterday Â· Dec 19                                                             │
│  â”Œ─────────────────────────────────────────────────────────────────────────â”    │
│  │  2:30:00    2:00 PM – 4:30 PM     Timer    💤 Mike Hansen    [Edit][âœ•]  │    │
│  └─────────────────────────────────────────────────────────────────────────â”˜    │
│  â”Œ─────────────────────────────────────────────────────────────────────────â”    │
│  │  0:45:00    Manual entry          Manual   💤 Mike Hansen    [Edit][âœ•]  │    │
│  │             "Research and planning"                                     │    │
│  └─────────────────────────────────────────────────────────────────────────â”˜    │
│                                                                                 │
│  ───────────────────────────────────────────────────────────────────────────────│
│  Total logged: 4h 38m 45s                                                       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────â”˜
```

### Time Entry Row

| Element | Content |
|---------|---------|
| Duration | `H:MM:SS` format, prominent |
| Time range | "Start – End" or "Manual entry" |
| Source | Badge: "Timer" or "Manual" |
| User | Avatar + name |
| Notes | Optional, shown below if present |
| Actions | Edit, Delete (on hover) |

### Grouping

Entries grouped by date, newest first. Each group shows:
- Date header: "Today Â· Dec 20" or "Yesterday Â· Dec 19" or "Dec 18"
- Entries within that date

### Manual Entry Form

Modal triggered by [+ Add Manual Entry]:

```
â”Œ─────────────────────────────────────────────────────────────────â”
│                                                                 │
│  Add Time Entry                                           [âœ•]   │
│  ───────────────────────────────────────────────────────────────│
│                                                                 │
│  Date                                                           │
│  [Dec 20, 2024                                            📦]   │
│                                                                 │
│  Duration                                                       │
│  [  2  ] h  [  30  ] m                                          │
│                                                                 │
│  Notes (optional)                                               │
│  [Research and initial planning                            ]    │
│                                                                 │
│  ───────────────────────────────────────────────────────────────│
│                                          [Cancel]  [Add Entry]  │
│                                                                 │
└─────────────────────────────────────────────────────────────────â”˜
```

**Empty state:** "No time logged yet. [Start timer] or [Add manual entry]"

---

## Notes Tab

```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│                                                                                 │
│  Notes                                                             [+ Add Note] │
│  ───────────────────────────────────────────────────────────────────────────────│
│                                                                                 │
│  â”Œ─────────────────────────────────────────────────────────────────────────â”    │
│  │  💤 Mike Hansen Â· Dec 19, 2024 at 3:45 PM                    [Edit][âœ•]  │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Client requested we use the blue from their logo (#2B5797) for the     │    │
│  │  hero section background instead of the gray we originally planned.     │    │
│  └─────────────────────────────────────────────────────────────────────────â”˜    │
│                                                                                 │
│  â”Œ─────────────────────────────────────────────────────────────────────────â”    │
│  │  💤 Sarah Jenkins Â· Dec 18, 2024 at 11:00 AM                 [Edit][âœ•]  │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  See attached wireframe from client kickoff meeting.                    │    │
│  │  📽 homepage-wireframe.pdf                                              │    │
│  └─────────────────────────────────────────────────────────────────────────â”˜    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────â”˜
```

### Note Card

| Element | Content |
|---------|---------|
| Author | Avatar + name |
| Timestamp | Date and time |
| Content | Rich text |
| Attachments | File icons with names (clickable) |
| Actions | Edit, Delete (own notes only) |

Sorted newest first.

**Empty state:** "No notes yet. [Add a note]"

---

## Activity Tab

```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│                                                                                 │
│  Activity                                                                       │
│  ───────────────────────────────────────────────────────────────────────────────│
│                                                                                 │
│  Today                                                                          │
│  â”œ─ 10:24 AM  💤 Mike stopped timer (1h 23m logged)                            │
│  â”œ─  9:00 AM  💤 Mike started timer                                            │
│                                                                                 │
│  Yesterday                                                                      │
│  â”œ─  4:30 PM  💤 Mike stopped timer (2h 30m logged)                            │
│  â”œ─  2:00 PM  💤 Mike started timer                                            │
│  â”œ─ 11:30 AM  💤 Sarah changed status: Ready → In Progress                     │
│  â”œ─ 11:00 AM  💤 Sarah assigned quest to Mike Hansen                           │
│                                                                                 │
│  Dec 17                                                                         │
│  â”œ─  3:00 PM  💤 Sarah created quest                                           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────â”˜
```

### Activity Types

| Event | Format |
|-------|--------|
| Created | "[User] created quest" |
| Assigned | "[User] assigned quest to [Assignee]" |
| Status change | "[User] changed status: [Old] → [New]" |
| Timer start | "[User] started timer" |
| Timer stop | "[User] stopped timer (Xh Xm logged)" |
| Due date change | "[User] set due date to [Date]" |
| Note added | "[User] added a note" |
| Subtask completed | "[User] completed subtask: [Name]" |

Read-only audit log. Grouped by date, newest first.

---

## Status-Specific Banners

Alert banners appear below tabs when quest is in certain states.

### Blocked State

```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│  🚫 This quest is blocked                                                       │
│     Waiting on: âš”️ Brand Guidelines Finalization (In Progress, 💤 Jane Doe)    │
│                                                                   [View Quest]  │
└─────────────────────────────────────────────────────────────────────────────────â”˜
```

| Element | Behavior |
|---------|----------|
| Alert style | Warning (amber left border) |
| Blocking quest | Link to that quest |
| Timer button | Disabled with tooltip "Unblock to start" |

---

### In Review State

**Assignee view:**
```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│  📋 This quest is awaiting review                                               │
│     Submitted for review on Dec 20 at 10:30 AM                                  │
└─────────────────────────────────────────────────────────────────────────────────â”˜
```

**PM/Admin view:**
```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│  📋 This quest is awaiting your review                                          │
│     Submitted by Mike Hansen on Dec 20 at 10:30 AM                              │
│                                                    [Approve]  [Return to Tech]  │
└─────────────────────────────────────────────────────────────────────────────────â”˜
```

| Action | Behavior |
|--------|----------|
| Approve | Changes status to Done, shows toast |
| Return to Tech | Opens modal for notes, changes status to Ready |

---

### Done State

```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│  âœ“ Quest completed                                                              │
│     Completed on Dec 21 at 2:00 PM Â· Total time: 6h 15m (Est: 3~5h)            │
│                                                                      [Reopen]   │
└─────────────────────────────────────────────────────────────────────────────────â”˜
```

| Element | Content |
|---------|---------|
| Alert style | Success (green left border) |
| Completion info | Date, total time vs estimate |
| Reopen | Returns quest to In Progress (with confirmation) |

---

## Status Transitions

### Allowed Transitions

| Current Status | Can Change To | Who Can Change |
|----------------|---------------|----------------|
| Ready | In Progress | Assignee, PM, Admin |
| In Progress | Ready, In Review, Blocked | Assignee, PM, Admin |
| In Review | Ready (returned), Done | PM, Admin |
| Blocked | Ready | Auto (when blocker done) or PM/Admin |
| Done | In Progress (reopen) | PM, Admin |

### Auto-Transitions

| Trigger | Transition |
|---------|------------|
| Timer started | Ready → In Progress |
| Blocking quest completed | Blocked → Ready |
| All subtasks completed | (Optional) Prompt to submit for review |

---

## Empty States

| Section | Message | Action |
|---------|---------|--------|
| Description | "No description yet." | [Add description] |
| Requirements | "No requirements." | [Add item] |
| Dependencies | "No dependencies. Dependencies help track what must be done before or after this quest." | [Add dependency] |
| Time Entries | "No time logged yet." | [Start timer] or [Add manual entry] |
| Notes | "No notes yet." | [Add a note] |
| Activity | (Never empty—creation is first entry) | — |

---

## Responsive Behavior

### Desktop (>1024px)

Two-column layout as documented.

### Tablet (768–1024px)

- Sidebar moves below main content
- Timer section becomes more prominent at top of sidebar area

### Mobile (<768px)

- Single column layout
- Timer widget becomes sticky mini-bar at top when scrolling
- Tabs become horizontally scrollable
- Details section collapsible

---

## Components Used

| Component | Usage |
|-----------|-------|
| Breadcrumbs | Navigation hierarchy |
| PageHeader | Title, meta line, primary action |
| Tabs | Overview, Time, Notes, Activity |
| Card | Section containers, Rune callout |
| StatusChip | Status display |
| EnergyBadge | Energy estimate |
| Avatar | Assignee, authors |
| TimerWidget (Full) | Sidebar timer |
| QuestCard | Dependencies display |
| Checkbox | Requirements checklist |
| Button | Actions |
| IconButton | More menu, edit, delete |
| Select | Status, Priority, Function dropdowns |
| EntitySelector | Assignee picker |
| DatePicker | Due date |
| TextInput | Requirement item text, manual entry |
| TextArea | Notes, description |
| Alert | Status banners (blocked, review, done) |
| Badge | Timer/Manual source indicator |
| Table | Time entries (styled as cards) |
| EmptyState | When sections have no content |
| Modal | Manual entry form, edit forms |
| Toast | Action confirmations |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `T` | Toggle timer (start/stop) |
| `E` | Edit quest |
| `S` | Focus status dropdown |
| `N` | Add new note |
| `?` | Show keyboard shortcuts |

---

## ND Optimizations Applied

| Principle | Implementation |
|-----------|----------------|
| **Timer-centric** | Timer always visible; primary action is start/stop |
| **Context preserved** | Full breadcrumb + sidebar links to parent entities |
| **Status-aware UI** | Page adapts visually based on quest state |
| **Reduced clicks** | Inline editing for status, assignee, dates |
| **Clear progress** | Subtask count, time summary, visual progress bars |
| **No anxiety colors** | Amber for warnings/blocked, never red |
| **Explicit states** | Banner alerts for blocked/review/done |
| **Predictable layout** | Consistent section structure across all quests |

---

## Related Documents

- `indelible-component-library.md` — Component specifications
- `indelible-wireframes-dashboards.md` — Dashboard wireframes
- `indelible-wireframes-global-shell.md` — Global navigation
- `indelible-user-flows.md` — User journey documentation
- `indelible-screen-inventory.md` — Complete screen list