# Indelible Application: QA Feature Summary
## Comprehensive Feature Inventory for Testing

**Version:** 1.0  
**Date:** December 2024  
**Purpose:** Quality Assurance Testing Reference

---

## Table of Contents

1. [Authentication & Authorization](#1-authentication--authorization)
2. [Global Shell & Navigation](#2-global-shell--navigation)
3. [Core Entities (Foundry)](#3-core-entities-foundry)
4. [Projects & Tasks (Sanctum)](#4-projects--tasks-sanctum)
5. [Time Tracking (Chronicles)](#5-time-tracking-chronicles)
6. [Role-Specific Dashboards (Overlook)](#6-role-specific-dashboards-overlook)
7. [SOPs & Documentation (Grimoire)](#7-sops--documentation-grimoire)
8. [Recipe/Wizard System](#8-recipewizard-system)
9. [Notifications & Alerts](#9-notifications--alerts)
10. [Reports & Data Views](#10-reports--data-views)
11. [User Preferences & Settings](#11-user-preferences--settings)
12. [Reference Data Management](#12-reference-data-management)
13. [Neurodivergent-Optimized Features](#13-neurodivergent-optimized-features)
14. [Future Features (Not MVP)](#14-future-features-not-mvp)

---

## 1. Authentication & Authorization

### 1.1 Login System

| Feature | Description | Test Criteria |
|---------|-------------|---------------|
| Email/Password Login | Standard login with credentials | Valid credentials → Dashboard redirect; Invalid → Error message |
| Session Management | JWT with HTTP-only cookies | Sessions persist across page refresh; 7-day absolute timeout |
| Idle Timeout | 2-hour inactivity logout | Idle timeout warning at 2 minutes; Auto-logout with URL preservation |
| Token Refresh | Silent refresh before expiration | Tokens refresh seamlessly; No user-visible interruption |
| Logout | Clear session and redirect | Session cleared; Redirected to login; Cannot access protected routes |

### 1.2 Password Reset Flow

| Feature | Description | Test Criteria |
|---------|-------------|---------------|
| Request Reset | Enter email → Receive link | Valid email → Success message (always, for security); Invalid → Same message |
| Reset Token | 4-hour expiration | Valid token → Password form; Expired → Error with new request option |
| Password Change | Set new password | Password updated; Redirected to login; Old password invalid |

### 1.3 Role-Based Access Control

**Three User Roles:** Tech, PM, Admin

| Capability | Tech | PM | Admin |
|------------|:----:|:--:|:-----:|
| View/execute assigned tasks | ✅ | ✅ | ✅ |
| Track time | ✅ | ✅ | ✅ |
| See all clients (no billing rates) | ✅ | ✅ | ✅ |
| See all projects (no budgets) | ✅ | ✅ | ✅ |
| See Tools & license keys | ✅ | ✅ | ✅ |
| Create ad-hoc tasks | ❌ | ✅ | ✅ |
| Manage own projects | ❌ | ✅ | ✅ |
| See billing for own projects | ❌ | ✅ | ✅ |
| Review tasks | ❌ | ✅ | ✅ |
| Create/edit SOPs & Recipes | ❌ | ✅ | ✅ |
| See activity history | ❌ | ✅ | ✅ |
| See all billing/rates | ❌ | ❌ | ✅ |
| See profitability reports | ❌ | ❌ | ✅ |
| Create users | ❌ | ❌ | ✅ |
| System settings | ❌ | ❌ | ✅ |

### 1.4 Field-Level Visibility

| Field | Tech | PM | Admin |
|-------|:----:|:--:|:-----:|
| Client hourly rate | Hidden | Visible | Visible |
| Client retainer hours | Hidden | Visible | Visible |
| Project budget hours | Hidden | Visible | Visible |
| Project budget amount | Hidden | Hidden | Visible |
| Hosting plan monthly cost | Hidden | Hidden | Visible |
| User hourly cost | Hidden | Hidden | Visible |
| Profitability data | Hidden | Hidden | Visible |

---

## 2. Global Shell & Navigation

### 2.1 Header Bar

| Element | Feature | Test Criteria |
|---------|---------|---------------|
| Sidebar Toggle | Expand/collapse sidebar | Toggle preserves state; Works on all pages |
| Logo | Navigate to Dashboard | Click → Overlook page |
| Search Bar | Global search trigger | Click or Cmd+K → Command palette opens |
| Active Timer | Shows when running | Hidden when inactive; Shows elapsed time and task reference when active |
| Notifications Bell | Unread count badge | Shows accurate unread count; Click opens notification panel |
| User Menu | Profile dropdown | Shows name; Links to settings; Logout option |

### 2.2 Sidebar Navigation

| Section | Items | Role Access |
|---------|-------|-------------|
| **Top Level** | Overlook, Timekeeper | All roles |
| **Foundry** | Pacts, Patrons, Sites, Domains, Quests, Tools | All roles |
| **Grimoire** | Runes (SOPs), Rituals (Recipes) | All (view); PM/Admin (edit) |
| **Armory** | Hosting, Maintenance | All (view); Admin (margins visible) |
| **Admin** | Team, Functions, Reports | Admin only |
| **Settings** | User Settings | All roles |

**Sidebar Behaviors:**
- Collapsible with icon-only mode
- Expandable sections with chevron indicators
- Active state highlighting
- Hover state on items
- Remembers collapsed/expanded state per session

### 2.3 Breadcrumb Navigation

| Pattern | Example |
|---------|---------|
| Patron Detail | 🧑‍🚀 Acme Corp |
| Site Detail | 🧑‍🚀 Acme Corp › 🏰 Main Website |
| Pact Detail | 🧑‍🚀 Acme Corp › 🏰 Main Website › 🤝 Redesign |
| Quest Detail | 🧑‍🚀 Acme Corp › 🤝 Redesign › ⚔️ Task Name |

**Behaviors:**
- All segments except last are clickable
- Truncates with "..." when path too long
- "..." expands on click to show hidden segments

### 2.4 Global Search (Command Palette)

| Feature | Test Criteria |
|---------|---------------|
| Trigger | Cmd+K (Mac) / Ctrl+K (Windows) or click search bar |
| Type-ahead | Results appear as user types with debounce |
| Entity Types | Returns Clients, Sites, Projects, Tasks, SOPs |
| Grouping | Results grouped by entity type with icons |
| Keyboard Navigation | Arrow keys navigate; Enter selects |
| Recent Searches | Shows recent searches (localStorage) |
| Role Filtering | Results respect role visibility rules |

### 2.5 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` / `Ctrl+K` | Open global search |
| `Cmd+N` / `Ctrl+N` | New Quest (from search modal) |
| `Cmd+\` / `Ctrl+\` | Toggle sidebar |
| `Esc` | Close modal/drawer |
| `↑` `↓` | Navigate search results |
| `Enter` | Select search result |

---

## 3. Core Entities (Foundry)

### 3.1 Patrons (Clients)

**Entity Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Business Name | Text | Yes | Primary identifier |
| Contact Person | Text | Yes | Main contact |
| Email | Email | Yes | Contact email |
| Phone | Phone | No | |
| Address | Text | No | |
| Status | Select | Yes | Active, Inactive, Prospect |
| Client Type | Select | Yes | Direct, Agency Partner, Sub-Client |
| Parent Client | Relation | Conditional | Required if Sub-Client |
| Hourly Rate | Currency | No | PM/Admin only |
| Retainer Hours | Number | No | Monthly retainer allocation |
| Notes | Rich Text | No | |

**CRUD Operations:**

| Operation | Access | Test Criteria |
|-----------|--------|---------------|
| List | All | Shows paginated list with search/filters |
| View | All | Detail page with tabs (Overview, Sites, Pacts, Billing, Notes) |
| Create | PM, Admin | Modal form; Validates required fields |
| Edit | PM, Admin | Modal form; Updates reflected immediately |
| Delete | Admin | Soft delete; Confirmation required |

**Special Behaviors:**
- Agency Partner → Sub-Client relationship hierarchy
- Client type dropdown shows parent client selector when "Sub-Client" selected
- Retainer status indicator when retainer_hours > 0

### 3.2 Sites

**Entity Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | Text | Yes | |
| Client | Relation | Yes | Parent client |
| URL | URL | No | Primary site URL |
| Hosting Plan | Relation | No | Reference data |
| Maintenance Plan | Relation | No | Reference data |
| Status | Select | Yes | Active, Development, Inactive |
| Notes | Rich Text | No | |

**CRUD Operations:**

| Operation | Access | Test Criteria |
|-----------|--------|---------------|
| List | All | Filterable by client |
| View | All | Detail with Domains tab |
| Create | PM, Admin | Must link to client |
| Edit | PM, Admin | Can change client association |
| Delete | Admin | Soft delete |

### 3.3 Domains

**Entity Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Domain Name | Text | Yes | e.g., example.com |
| Site | Relation | Yes | Parent site |
| Registrar | Text | No | Where registered |
| Expires At | Date | No | Expiration date |
| Is Primary | Boolean | No | Primary domain for site |
| Notes | Text | No | |

**CRUD Operations:**

| Operation | Access | Test Criteria |
|-----------|--------|---------------|
| List | All | Filterable by site/client |
| View | All | Detail drawer |
| Create | PM, Admin | Must link to site |
| Edit | PM, Admin | |
| Delete | Admin | Soft delete |

### 3.4 Tools

**Entity Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | Text | Yes | |
| Category | Select | Yes | Plugin, Service, Software, etc. |
| License Key | Text | No | Sensitive - all roles can view |
| Purchase URL | URL | No | |
| Documentation URL | URL | No | |
| Notes | Rich Text | No | |

**CRUD Operations:**

| Operation | Access | Test Criteria |
|-----------|--------|---------------|
| List | All | Searchable |
| View | All | Shows license keys |
| Create | PM, Admin | |
| Edit | PM, Admin | |
| Delete | Admin | Soft delete |

---

## 4. Projects & Tasks (Sanctum)

### 4.1 Pacts (Projects)

**Entity Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | Text | Yes | |
| Client | Relation | Yes | Inherits from site if linked |
| Site | Relation | No | |
| Project Manager | User | Yes | PM role user |
| Status | Select | Yes | Quote, Queue, Ready, In Progress, On Hold, Complete, Archived |
| Health | Computed | Auto | On Track, At Risk, Behind |
| Is Retainer Work | Boolean | No | Uses client's retainer hours |
| Budget Hours | Number | No | PM/Admin visible |
| Budget Amount | Currency | No | Admin only |
| Start Date | Date | No | |
| Target End Date | Date | No | |
| Recipe | Relation | No | Template used (if any) |
| Team Assignments | Multi-relation | No | Function → User mapping |
| Quick Links | JSON | No | Figma, Drive, Proposal links |

**Project Statuses:**

| Status | Description | Task Visibility |
|--------|-------------|-----------------|
| Quote | Proposal stage | Tasks hidden from Tech |
| Queue | Approved, not started | Tasks hidden from Tech |
| Ready | Ready to begin | Tasks visible to assignees |
| In Progress | Actively working | Tasks visible to assignees |
| On Hold | Temporarily paused | Tasks visible but flagged |
| Complete | All work finished | Tasks visible (read-only) |
| Archived | Closed permanently | Hidden from default views |

**CRUD Operations:**

| Operation | Access | Test Criteria |
|-----------|--------|---------------|
| List | All | Filtered by status; PM sees own; Admin sees all |
| View | All | Tabs: Overview, Quests, Time & Budget, Notes, Activity |
| Create (Simple) | PM, Admin | Modal form |
| Create (Wizard) | PM, Admin | Multi-step wizard from Recipe |
| Edit | PM, Admin | Modal form |
| Delete | Admin | Soft delete with confirmation |

**Special Behaviors:**
- Status change from Quote/Queue → Ready triggers task visibility to assignees
- Health computed from milestone tracking and task completion rate
- Budget vs Actual time tracking (PM/Admin only)

### 4.2 Quests (Tasks)

**Entity Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Title | Text | Yes | |
| Project | Relation | No | Parent project |
| Client | Relation | Yes | Inherited or direct |
| Site | Relation | No | |
| Status | Select | Yes | See status list below |
| Priority | Select | Yes | 1-5 (1 = highest) |
| Assignee | User | No | Who does the work |
| Reviewer | User | No | Who approves (default: PM) |
| Function | Relation | No | Role type for assignment |
| Phase | Select | No | Design, Build, Launch, etc. |
| Energy Impact | Number | No | Base effort estimate (1-10) |
| Mystery Factor | Select | No | None, Average, Significant, No Idea |
| Battery Impact | Number | No | Cognitive drain (negative if draining) |
| Weighted Energy | Computed | Auto | energy × mystery multiplier |
| Due Date | Date | No | |
| Is Billable | Boolean | Yes | Default true |
| Is Retainer Work | Boolean | No | Inherits from project/client |
| No Review | Boolean | No | Skip review step |
| SOP | Relation | No | Linked procedure |
| Requirements | JSON | No | Checklist items |
| Dependencies | Multi-relation | No | Blocked by other tasks |
| Notes | Rich Text | No | |

**Task Status State Machine:**

| Status | Can Transition To |
|--------|-------------------|
| Not Started | In Progress, Blocked |
| In Progress | Ready (back), Blocked, Review, Done |
| Blocked | Not Started, In Progress (when unblocked) |
| Review | In Progress (returned), Done (approved) |
| Done | (Terminal state) |

**Status Behaviors:**

| Status | Requirements |
|--------|--------------|
| Blocked | Must provide blocked_reason; Notifies PM |
| Review | Task submitted; Reviewer notified |
| Done | Requires review approval unless no_review=true |

**Mystery Factor Calculations:**

| Mystery Factor | Multiplier | Variance |
|----------------|------------|----------|
| None | 1.0× | 1.0× |
| Average | 1.3× | 1.5× |
| Significant | 1.5× | 1.75× |
| No Idea | 1.75× | 2.0× |

**Requirements Checklist:**

| Feature | Test Criteria |
|---------|---------------|
| Add item | New checkbox item added |
| Edit text | Text updates inline |
| Toggle complete | Checkbox toggles; Records timestamp and user |
| Reorder | Drag-drop reordering |
| Delete | Remove with confirmation |
| Progress | "X of Y complete" summary shown |

**Task Dependencies:**

| Feature | Test Criteria |
|---------|---------------|
| Add blocker | Select blocking task |
| Remove blocker | Unlink dependency |
| Blocking indicator | Task shows "Blocked by X" |
| Auto-unblock | When all blockers complete, task becomes ready |

### 4.3 Notes

**Attached to:** Clients, Sites, Projects (roll-up display)

| Feature | Test Criteria |
|---------|---------------|
| Create | Add note with rich text content |
| View | Displays author, timestamp, source context |
| Edit | Original author can edit |
| Delete | Original author can delete |
| Roll-up | Client notes visible on Site; Site notes on Project |

---

## 5. Time Tracking (Chronicles)

### 5.1 Timer System

**Timer States:**
- Inactive: No timer running
- Active: Timer running for a specific task

**Timer Behaviors:**

| Feature | Test Criteria |
|---------|---------------|
| Start (from task) | Click timer button on task → Timer starts immediately |
| Start (from header) | Click timer icon → Select task → Start |
| Running display | Header shows elapsed time with task reference |
| Navigation persistence | Timer continues across page changes |
| Browser persistence | Uses localStorage timestamp for page refresh recovery |
| Stop | Creates time entry with calculated duration |
| Switch task | Stops current timer, starts new one (with confirmation) |

### 5.2 Time Entries

**Entity Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Task | Relation | Yes | |
| Project | Relation | Auto | From task |
| User | Relation | Yes | Current user |
| Started At | DateTime | Yes | |
| Ended At | DateTime | Yes | |
| Duration | Minutes | Computed | |
| Is Billable | Boolean | Yes | Default from task |
| Hourly Rate | Currency | No | Snapshot of rate at entry time |
| Description | Text | No | Notes about work done |
| Source | Select | Auto | Timer or Manual |

**CRUD Operations:**

| Operation | Access | Test Criteria |
|-----------|--------|---------------|
| List (own) | All | User sees their entries |
| List (project) | PM, Admin | See all entries for a project |
| Create (timer) | All | Stopping timer creates entry |
| Create (manual) | All | Modal form with start/end times |
| Edit | Owner only | Can modify own entries |
| Delete | Owner only | With confirmation |

### 5.3 Chronicles Page (Time View)

| View | Features |
|------|----------|
| Daily | Today's entries by default; Date picker to change |
| Weekly | Week selector; Day-by-day breakdown; Totals per day |
| Summary | Total hours display; Billable vs Non-billable split |

### 5.4 Time on Entities

| Entity | Display |
|--------|---------|
| Task Detail | Time entries list; Total time; Add entry button |
| Project Detail | All time entries; Grouped by task or user; Budget vs Actual |

---

## 6. Role-Specific Dashboards (Overlook)

### 6.1 Tech Dashboard

| Section | Content | Test Criteria |
|---------|---------|---------------|
| Active Timer | Current task timer widget | Shows elapsed time and task; Stop button |
| My Quests | Assigned tasks (Ready, In Progress) | Grouped by priority or status; Only visible project tasks |
| Blocked Quests | Tasks in blocked status | Shows blocked reason |
| Recent Time | Last 5 time entries | With task context |
| Missing Time Alert | "No time logged today" | Shows when no entries for current day |

### 6.2 PM Dashboard

| Section | Content | Test Criteria |
|---------|---------|---------------|
| Focus Quests | High priority, in-progress tasks | Limited to top 3-5 items |
| Awaiting Review | Tasks in Review status | Where user is reviewer |
| Unassigned Quests | Tasks with no assignee | On PM's projects |
| My Pacts | Active projects with health indicators | Shows status, progress, next milestone |
| Retainer Alerts | Clients approaching/exceeding retainer | Amber warnings at 80%, 100% |
| Recent Items | Sidebar with recently viewed entities | For context recovery |

### 6.3 Admin Dashboard

| Section | Content | Test Criteria |
|---------|---------|---------------|
| All PM Features | Same as PM dashboard | Plus expanded visibility |
| All Active Pacts | Every active project | Not filtered by assignment |
| Team Utilization | (Placeholder for future) | Shows all team members |
| System Alerts | System-wide notifications | Admin-only alerts |

---

## 7. SOPs & Documentation (Grimoire)

### 7.1 Runes (SOPs)

**Entity Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | Text | Yes | |
| Description | Text | No | |
| Content | Rich Text | No | TipTap JSON content |
| Owner Function | Relation | No | Who maintains this SOP |
| Default Function | Relation | No | Who typically performs work |
| Phase | Select | No | Default phase for tasks |
| Energy Impact | Number | No | Default estimate |
| Mystery Factor | Select | No | Default mystery level |
| Battery Impact | Number | No | Default cognitive impact |
| Priority | Number | No | Default priority |
| No Review | Boolean | No | Skip review by default |
| Template Requirements | JSON | No | Checklist items to copy to tasks |
| Tool References | Multi-relation | No | Related tools |
| Tags | Multi-select | No | Categorization |
| Review Interval | Days | No | How often to review |
| Last Reviewed | Date | No | Last review date |

**CRUD Operations:**

| Operation | Access | Test Criteria |
|-----------|--------|---------------|
| List | All | Searchable; Filterable by function |
| View | All | Rich text rendered; Tool embeds with license keys |
| Create | PM, Admin | Metadata modal → Detail page for content |
| Edit | PM, Admin | TipTap editor for rich text |
| Mark Reviewed | PM, Admin | Updates last_reviewed date |
| Delete | Admin | Soft delete |

### 7.2 TipTap Rich Text Editor

| Feature | Test Criteria |
|---------|---------------|
| Headings | H1, H2, H3 support |
| Paragraphs | Normal text blocks |
| Bold/Italic/Underline | Inline formatting |
| Links | URL links |
| Bulleted Lists | Unordered lists |
| Numbered Lists | Ordered lists |
| Checklists | Interactive checkboxes |
| Images | Embedded images |
| Tool Embeds | Auto-populate license keys |
| Read-only Mode | Rendered content (non-edit view) |

### 7.3 SOP → Task Integration

| Feature | Test Criteria |
|---------|---------------|
| Link SOP to Task | Select SOP during task creation |
| Copy Requirements | Template requirements copied as task checklist |
| Apply Defaults | Phase, energy, function defaults applied |
| Reference Link | Task shows linked SOP with expand option |
| Content View | SOP content viewable inline or via link |

---

## 8. Recipe/Wizard System

### 8.1 Rituals (Recipes)

**Entity Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | Text | Yes | |
| Description | Text | No | |
| Category | Select | No | Website, SEO, Maintenance, etc. |
| Is Active | Boolean | Yes | Available for use |
| Requires Sitemap | Boolean | No | Needs page configuration |
| Trigger Description | Text | No | When to use this recipe |
| Phases | JSON | Yes | Ordered phase definitions |
| Documentation | Rich Text | No | Usage instructions |
| Estimated Tasks | Computed | Auto | Count of task templates |

**Recipe Tasks (Templates):**

| Field | Type | Notes |
|-------|------|-------|
| Name | Text | May include {{page_name}} variable |
| SOP | Relation | Linked procedure |
| Function | Relation | Who performs |
| Phase | Select | Which phase |
| Order | Number | Sort within phase |
| Task Type | Select | one_off, variable, milestone, recurring |
| Is Milestone | Boolean | Triggers billing? |
| Billing Percentage | Decimal | % of budget for milestone |
| Dependencies | Array | References to other recipe tasks |
| Variable Config | JSON | For variable task generation |

**Task Types:**

| Type | Description | Generation |
|------|-------------|------------|
| One-off | Single task | 1 task |
| Variable | Per-page/item | N tasks based on sitemap |
| Milestone | Approval gate | 1 task, may trigger billing |
| Recurring | Repeating | Generated on schedule |

### 8.2 Project Creation Wizard

**Step 1: Select Ritual**
- Recipe cards with descriptions
- Preview phases and task count
- "Blank Project" option for no template

**Step 2: Patron & Site**
- Client selector (required)
- Site selector (optional, filtered by client)
- Create new site inline option

**Step 3: Sitemap Input** (if recipe requires)
- Define website pages
- Page type selection (Homepage, Interior, Landing)
- Options per page (needs mockup, needs content)
- Preview of variable tasks to be generated

**Step 4: Team Assignment**
- List of functions from recipe
- User selector for each function
- Option to leave unassigned

**Step 5: Review & Configure**
- Project name (editable)
- Review all generated tasks
- Adjust milestones
- Set dates
- Budget configuration

**Step 6: Confirmation**
- Summary of created project
- Task count
- Links to project and key tasks
- Suggested next steps

**Wizard Behaviors:**

| Feature | Test Criteria |
|---------|---------------|
| Navigation | Next/Back between steps |
| Validation | Each step validates before proceeding |
| Draft Save | (Future) Save incomplete wizard state |
| Cancel | Confirmation dialog; No data created |
| Generation | Creates project with all tasks and assignments |

### 8.3 Task Generation

| Feature | Test Criteria |
|---------|---------------|
| One-off Tasks | Created exactly once |
| Variable Tasks | Created per page/item in sitemap |
| Name Variables | {{page_name}} replaced with actual page name |
| Dependencies | Task dependencies preserved from recipe |
| Function Assignment | Mapped to user via team assignments |
| Milestones | Created with billing configuration |

---

## 9. Notifications & Alerts

### 9.1 Notification System

**Notification Events:**

| Event | Recipient | Message |
|-------|-----------|---------|
| Project Activated (Quote→Ready) | Each assignee | "You have X new quests on [Project]" |
| Task Assigned | Assignee | "You've been assigned: [Task]" |
| Task Reassigned | New assignee | "You've been assigned: [Task]" |
| Task Reassigned | Old assignee | "[Task] has been reassigned" |
| Task Blocked | Project PM | "[Task] blocked by [Assignee]: [reason]" |
| Task Unblocked | Assignee | "[Task] is now ready to start" |
| Task Submitted | Reviewer | "[Task] is ready for review" |
| Task Approved | Assignee | "[Task] has been approved" |
| Task Returned | Assignee | "[Task] returned for changes: [comment]" |
| Retainer Warning (80%) | PM | "[Client] approaching retainer limit" |
| Retainer Exceeded | PM | "[Client] has exceeded retainer hours" |

### 9.2 Notification Bundling

| Feature | Test Criteria |
|---------|---------------|
| 30-minute window | Multiple notifications of same type bundled |
| Bundle display | "You have 5 new quests on [Project]" |
| Individual fallback | After window, new notifications are individual |

### 9.3 Notification Panel

| Feature | Test Criteria |
|---------|---------------|
| Unread count | Badge on bell icon shows count |
| Panel open | Click bell → Notification list |
| Mark as read | Click notification marks as read |
| Mark all read | Button to clear all unread |
| Navigation | Click notification → Navigate to entity |
| Settings link | Link to notification preferences |

---

## 10. Reports & Data Views

### 10.1 Time Reports

| Feature | Test Criteria |
|---------|---------------|
| Date Range Filter | Start/end date selectors |
| Client Filter | Filter by client |
| Project Filter | Filter by project |
| User Filter | Filter by team member |
| Grouping | By day, week, project, or user |
| Totals | Total hours, billable hours, percentage |
| CSV Export | Download filtered data |

**Access:** PM sees own projects; Admin sees all

### 10.2 Retainer Usage Report

| Feature | Test Criteria |
|---------|---------------|
| By Client | Clients with retainer hours |
| Current Month | Usage vs allocation |
| Overage Display | Hours over limit |
| Trend | Last 3 months usage |
| Alerts | Visual indicators at 80%, 100% |

**Access:** PM, Admin

### 10.3 Project Health Report

| Feature | Test Criteria |
|---------|---------------|
| Active Projects | All projects in Ready/In Progress |
| Health Status | On Track, At Risk, Behind |
| PM Filter | Filter by project manager |
| Milestone View | Upcoming milestones |
| Export | CSV download |

**Access:** PM, Admin

### 10.4 Profitability Report

| Feature | Test Criteria |
|---------|---------------|
| By Client | Revenue vs cost by client |
| By Project | Revenue vs cost by project |
| Time Period | Date range filter |
| Margin Calculation | (Revenue - Cost) / Revenue |
| Export | CSV download |

**Access:** Admin only

---

## 11. User Preferences & Settings

### 11.1 Profile Settings

| Field | Description |
|-------|-------------|
| Name | Display name |
| Email | Account email |
| Phone | Contact phone |
| Avatar | Profile image |
| Timezone | User's timezone |
| Password Change | Change password form |

### 11.2 Application Preferences

| Preference | Options | Description |
|------------|---------|-------------|
| Naming Convention | Awesome / Standard | Fantasy vs conventional terminology |
| Theme | Light / Dim / Dark / System | Color theme (future) |
| Notification Bundling | On / Off | Bundle similar notifications |

### 11.3 Notification Preferences

| Notification Type | In-App Toggle | Email Toggle (Future) |
|-------------------|:-------------:|:---------------------:|
| Quest assigned | ✅ | ✅ |
| Quest ready | ✅ | ✅ |
| Quest commented | ✅ | ✅ |
| Quest mentioned | ✅ | ✅ |
| Quest returned | ✅ | ✅ |
| Review ready | ✅ | ✅ |
| Retainer warning | ✅ | ✅ |
| Milestone triggered | ✅ | ✅ |

### 11.4 Terminology Toggle

**Awesome (Default) vs Standard:**

| Standard | Awesome | Icon |
|----------|---------|------|
| Client | Patron | 🧑‍🚀 |
| Site | Site | 🏰 |
| Project | Pact | 🤝 |
| Task | Quest | ⚔️ |
| SOP | Rune | 📜 |
| Recipe | Scroll/Ritual | 🧑‍🍳 |
| Dashboard | Overlook | 🏔️ |
| Team Member | Guild Member | 👥 |
| Meeting | Council | 🗣️ |

**Applied To:** Sidebar labels, page headers, breadcrumbs, form labels, button text, empty states, toast messages

---

## 12. Reference Data Management

### 12.1 Functions (Job Roles)

| Field | Type |
|-------|------|
| Name | Text |
| Description | Text |
| Color | Color picker |

**Access:** Admin CRUD; All view

### 12.2 Hosting Plans

| Field | Type | Admin Only |
|-------|------|:----------:|
| Name | Text | |
| Description | Text | |
| Monthly Cost | Currency | ✅ |
| Margin | Percentage | ✅ |
| Features | Text | |

**Access:** Admin CRUD; All view (cost/margin hidden from non-Admin)

### 12.3 Maintenance Plans

| Field | Type | Admin Only |
|-------|------|:----------:|
| Name | Text | |
| Description | Text | |
| Monthly Cost | Currency | ✅ |
| Margin | Percentage | ✅ |
| Included Hours | Number | |

**Access:** Admin CRUD; All view (cost/margin hidden from non-Admin)

### 12.4 User Management

| Feature | Test Criteria |
|---------|---------------|
| User List | All users with role, status |
| Create User | Name, email, role, function(s) |
| Edit User | Update profile, role, status |
| Deactivate | Soft disable account |
| Function Assignment | Assign multiple functions to user |

**Access:** Admin only

---

## 13. Neurodivergent-Optimized Features

### 13.1 Visual Design Principles

| Principle | Implementation |
|-----------|----------------|
| Calm Colors | Warm off-white background; No harsh black/white |
| No Red Warnings | Amber (#F5A623) for all warnings/alerts |
| Consistent Layout | Sidebar and header positions never change |
| Clear Boundaries | Cards, sections, whitespace for grouping |
| Icons + Labels | Every nav item has both |
| Visible Focus | 2px accent ring on focused elements |

### 13.2 Cognitive Load Reduction

| Feature | Implementation |
|---------|----------------|
| 3-5 Options Max | Limited choices per context |
| Today Default | Dashboards show today's work |
| Progressive Disclosure | Sections collapse; Expand on demand |
| Recent Items | Sidebar shows recently viewed for recovery |
| Context Preservation | Breadcrumbs always visible |

### 13.3 Interaction Patterns

| Pattern | Implementation |
|---------|----------------|
| One Question per Response | Avoid multiple questions in dialogs |
| Predictable Actions | Same actions in same positions |
| No Auto-Dismiss | User controls notification dismissal |
| Explicit States | Status badges, banners for current state |
| Inline Editing | Status, assignee, dates editable inline |

### 13.4 Animation Settings

| Default | Description |
|---------|-------------|
| No Animation | Respects `prefers-reduced-motion` |
| Instant Transitions | Page changes have no animation |
| No Bounce/Parallax | Avoid disorienting effects |

**Allowed (when motion OK):**
- Toast fade: 150ms
- Loading spinner rotation
- Hover background: 100ms

### 13.5 Energy/Battery System

| Feature | Description |
|---------|-------------|
| Energy Estimate | 1-10 scale for effort |
| Mystery Factor | Uncertainty multiplier |
| Battery Impact | Cognitive drain indicator (negative = draining) |
| Weighted Display | Shows range: "⚡3~5 hrs" |

---

## 14. Future Features (Not MVP)

The following features are planned but NOT included in initial release:

### Integrations
- QuickBooks (invoicing, payments, customer sync)
- Proposify replacement (proposals, e-signatures)
- Slack notifications
- Email notifications

### Features
- Client dashboard / portal
- White-label partner dashboard
- Team workload visualization
- Saved custom views/filters
- Custom field admin
- Content Strategy tool with AI
- Research database
- Load balancing for assignments
- PDF report exports
- Revenue reports
- Team utilization reports
- Support ticket volume reports
- Dark theme

### Second Pass Items (Pre-Launch Polish)
- Entity editing robustness
- "Prospect" client status
- "Never Again" client status
- Site client editing
- Domain site/client editing
- Count summaries on list views

---

## Appendix A: API Endpoint Summary

### Authentication
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### Clients
- `GET /api/clients` (list with filters)
- `GET /api/clients/:id`
- `POST /api/clients`
- `PATCH /api/clients/:id`
- `DELETE /api/clients/:id` (soft delete)

### Sites
- `GET /api/sites`
- `GET /api/sites/:id`
- `POST /api/sites`
- `PATCH /api/sites/:id`
- `DELETE /api/sites/:id`

### Domains
- `GET /api/domains`
- `GET /api/domains/:id`
- `POST /api/domains`
- `PATCH /api/domains/:id`
- `DELETE /api/domains/:id`

### Projects
- `GET /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/projects/:id/generate-tasks`

### Tasks
- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `PATCH /api/tasks/:id/status`
- `DELETE /api/tasks/:id`

### Time Entries
- `GET /api/time-entries`
- `GET /api/time-entries/:id`
- `POST /api/time-entries`
- `PATCH /api/time-entries/:id`
- `DELETE /api/time-entries/:id`
- `POST /api/time-entries/start`
- `POST /api/time-entries/stop`

### SOPs
- `GET /api/sops`
- `GET /api/sops/:id`
- `POST /api/sops`
- `PATCH /api/sops/:id`
- `DELETE /api/sops/:id`
- `POST /api/sops/:id/mark-reviewed`

### Recipes
- `GET /api/recipes`
- `GET /api/recipes/:id`
- `POST /api/recipes`
- `PATCH /api/recipes/:id`
- `DELETE /api/recipes/:id`

### Reference Data
- `GET|POST|PATCH|DELETE /api/hosting-plans`
- `GET|POST|PATCH|DELETE /api/maintenance-plans`
- `GET|POST|PATCH|DELETE /api/functions`
- `GET|POST|PATCH|DELETE /api/tools`

### Users & Settings
- `GET /api/users`
- `GET /api/users/:id`
- `POST /api/users`
- `PATCH /api/users/:id`
- `GET /api/users/me/preferences`
- `PATCH /api/users/me/preferences`

### Dashboard & Search
- `GET /api/dashboard`
- `GET /api/search?q=query`

### Reports
- `GET /api/reports/time`
- `GET /api/reports/retainers`
- `GET /api/reports/health`
- `GET /api/reports/profitability` (Admin)

### Notifications
- `GET /api/notifications`
- `PATCH /api/notifications/:id/read`
- `POST /api/notifications/mark-all-read`

---

## Appendix B: E2E Test Scenarios

### E2E-1: Authentication Flow
1. Navigate to /login
2. Enter valid credentials
3. Assert redirect to dashboard
4. Assert user menu shows name
5. Click logout
6. Assert redirect to login
7. Attempt protected route
8. Assert redirect to login

### E2E-2: Project Creation Wizard
1. Navigate to new project wizard
2. Select recipe
3. Select client and site
4. Enter sitemap pages
5. Assign team members
6. Review and confirm
7. Assert project created with tasks
8. Assert tasks have correct assignments

### E2E-3: Task Lifecycle
1. View dashboard as Tech
2. Click on task in "My Quests"
3. Change status to In Progress
4. Start timer
5. Work (wait)
6. Stop timer
7. Assert time entry created
8. Change status to Review
9. Switch to PM account
10. Approve task
11. Assert status is Done

### E2E-4: Time Tracking
1. Open task detail
2. Start timer
3. Navigate to different pages
4. Assert timer persists
5. Stop timer
6. Assert entry created with correct duration
7. Add manual entry
8. Edit entry
9. View in Chronicles
10. Assert totals correct

### E2E-5: Blocked Task Flow
1. Create task with dependency
2. Attempt to start blocked task
3. Assert blocked message
4. Complete blocking task
5. Assert notification created
6. Verify blocked task now available

### E2E-6: Retainer Tracking
1. Create client with retainer hours
2. Create task for client
3. Assert retainer meter shows 0%
4. Add time entry
5. Assert usage updates
6. Exceed 80%
7. Assert warning notification

### E2E-7: Permission Boundaries
1. Login as Tech
2. Navigate to /settings/users
3. Assert 403 or redirect
4. Navigate to client detail
5. Assert billing rate hidden
6. Logout
7. Login as PM
8. Assert can see billing rate

---

*Document generated from Indelible project documentation — December 2024*