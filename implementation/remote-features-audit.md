# Indelible App: Complete Feature Inventory
## Master Reference for MVP Features & Requirements

**Version:** 1.0  
**Date:** December 2024  
**Status:** ✅ Complete  
**Purpose:** Comprehensive checklist of all features to ensure nothing is missed during implementation

---

## Table of Contents

1. [Authentication & User Management](#1-authentication--user-management)
2. [Clients/Patrons](#2-clientspatrons)
3. [Sites](#3-sites)
4. [Domains](#4-domains)
5. [Projects/Pacts](#5-projectspacts)
6. [Tasks/Quests](#6-tasksquests)
7. [Requirements/Checklist](#7-requirementschecklist-within-tasks)
8. [Time Tracking](#8-time-tracking)
9. [Dashboards/Overlooks](#9-dashboardsoverlooks)
10. [SOPs/Runes](#10-sopsrunes)
11. [Recipes/Rituals](#11-recipesrituals-project-templates)
12. [Project Creation Wizard](#12-project-creation-wizard)
13. [Reference Data Management](#13-reference-data-management-admin)
14. [Notifications](#14-notifications)
15. [Global Search](#15-global-search)
16. [User Preferences/Settings](#16-user-preferencessettings)
17. [Reports](#17-reports)
18. [Global UI/UX Features](#18-global-uiux-features)
19. [Notes & Comments](#19-notes--comments)
20. [Meetings](#20-meetings)
21. [Phase Coverage Matrix](#21-phase-coverage-matrix)
22. [Gaps & Second Pass Items](#22-gaps--second-pass-items)

---

## 1. Authentication & User Management

### Core Authentication
| Feature | Description | Phase |
|---------|-------------|-------|
| JWT Authentication | HTTP-only cookies for secure token storage | 1 |
| Login | Email/password authentication | 1 |
| Logout | Session invalidation | 1 |
| Forgot Password | Email-based reset request | 1 |
| Reset Password | Token-based password reset | 1 |
| Session Refresh | Automatic token refresh | 1 |

### Role-Based Access Control
| Role | Description | Access Level |
|------|-------------|--------------|
| Tech | Team member | Limited — own tasks, time tracking |
| PM | Project Manager | Moderate — projects, clients, team tasks |
| Admin | Administrator | Full — all features, settings, users |

### User Profile & Management
| Feature | Description | Phase |
|---------|-------------|-------|
| Profile Management | Name, email, phone, avatar | 1 |
| Password Change | Self-service password update | 1 |
| User CRUD | Admin creates/manages users | 2 |
| User Functions | Many-to-many user ↔ function mapping | 2 |
| Weekly Availability | Hours available per week | 2 |
| Hourly Cost | Internal cost tracking | 2 |
| Velocity Tracking | Calculated from completed work history | 5 |
| User Activation/Deactivation | Soft disable without deletion | 2 |

---

## 2. Clients/Patrons

### Core CRUD
| Feature | Description | Phase |
|---------|-------------|-------|
| Create Client | Modal form with validation | 2 |
| View Client List | Paginated with search/filter | 2 |
| View Client Detail | Full page with tabs | 2 |
| Edit Client | Modal form | 2 |
| Soft Delete | Archive without data loss | 2 |

### Client Properties
| Property | Type | Notes |
|----------|------|-------|
| Business Name | String | Required |
| Type | Enum | Direct, Agency Partner, Sub-client |
| Parent Agency | Relation | For sub-clients only |
| Contact Person | String | Primary contact name |
| Email | String | Contact email |
| Phone | String | Contact phone |
| Status | Enum | Active, Inactive, Never Again, Delinquent |
| Hourly Rate | Decimal | Default billing rate (hidden from Tech) |
| Retainer Hours | Decimal | Monthly allocation |
| Icon | String | Emoji or icon identifier |
| Primary PM | Relation | Assigned PM user |

### Client Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Agency Partner Hierarchy | Parent-child relationships | 2 |
| Retainer Tracking | Used vs. remaining hours | 9 |
| Retainer Status | On track / Warning / Exceeded | 9 |
| Sites Tab | View all sites for client | 2 |
| Projects Tab | View all projects for client | 3 |
| Notes Tab | Client notes + rolled up from sites/projects | 8 |
| Billing Tab | Rates, retainer config (PM/Admin only) | 2 |

### Client List Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Search | By name, contact | 2 |
| Filter by Status | Active, Inactive, etc. | 2 |
| Filter by Type | Direct, Agency, Sub-client | 2 |
| Sort Options | Name, recently updated | 2 |
| Count Summaries | Sites count, active projects count | 2 |

---

## 3. Sites

### Core CRUD
| Feature | Description | Phase |
|---------|-------------|-------|
| Create Site | Modal form, client pre-selected if context | 2 |
| View Site List | Paginated with search/filter | 2 |
| View Site Detail | Full page with tabs | 2 |
| Edit Site | Modal form | 2 |
| Soft Delete | Archive without data loss | 2 |

### Site Properties
| Property | Type | Notes |
|----------|------|-------|
| Name | String | Primary domain or identifier |
| Client | Relation | Required — site owner |
| URL | String | Live site URL |
| Platform | Enum | WPMU Dev, Cloudways, GoDaddy, Other |
| Hosted By | Enum | Indelible, Client |
| Hosting Plan | Relation | Selected hosting tier |
| Maintenance Plan | Relation | Selected maintenance tier |
| Webmaster | Relation | Assigned user |
| Icon | String | Emoji or icon |
| Notes | Text | Quick notes field |

### Site Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Domains Tab | Associated domains with expiration | 2 |
| Projects Tab | Projects for this site | 3 |
| Tasks Tab | Ad-hoc tasks (not in project) | 3 |
| Notes Tab | Site notes + rolled up from projects | 8 |
| Quick Links | Configurable external links (live site, WP admin, etc.) | 2 |
| Maintenance Usage | Hours used this month vs. allocation | 9 |

### Site List Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Search | By name, domain | 2 |
| Filter by Client | Select specific patron | 2 |
| Filter by Platform | WPMU Dev, Cloudways, etc. | 2 |
| Filter by Hosting Plan | Has/doesn't have | 2 |
| Filter by Maintenance Plan | Has/doesn't have | 2 |

---

## 4. Domains

### Core CRUD
| Feature | Description | Phase |
|---------|-------------|-------|
| Create Domain | Modal form, site pre-selected if context | 2 |
| View Domain List | Paginated table | 2 |
| View Domain Detail | Peek drawer | 2 |
| Edit Domain | Modal form | 2 |
| Soft Delete | Archive without data loss | 2 |

### Domain Properties
| Property | Type | Notes |
|----------|------|-------|
| Domain Name | String | Required |
| Site | Relation | Required — parent site |
| Registrar | String | Where registered |
| DNS Provider | String | Where DNS is managed |
| Account Owner | String | Who owns the account |
| Expiration Date | Date | Domain expiry |
| SSL Expiration | Date | Certificate expiry |
| Notes | Text | Additional notes |

### Domain Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Expiration Alerts | Notify when expiring soon | 8 |
| SSL Alerts | Notify when SSL expiring | 8 |
| Filter by Expiring Soon | 30/60/90 day filters | 2 |

---

## 5. Projects/Pacts

### Core CRUD
| Feature | Description | Phase |
|---------|-------------|-------|
| Create Project (Simple) | Modal form | 3 |
| Create Project (Wizard) | Multi-step guided creation | 6 |
| View Project List | Paginated with filters | 3 |
| View Project Detail | Full page with tabs | 3 |
| Edit Project | Modal form | 3 |
| Soft Delete | Archive project | 3 |

### Project Properties
| Property | Type | Notes |
|----------|------|-------|
| Name | String | Required |
| Client | Relation | Required |
| Site | Relation | Optional |
| Recipe | Relation | Template used (if wizard) |
| Status | Enum | See workflow below |
| Type | Enum | Project, Retainer, Ad-hoc, Internal |
| PM | Relation | Project manager user |
| Budget | Decimal | Total budget (Admin/PM only) |
| Is Retainer Work | Boolean | Counts against retainer |
| Start Date | Date | Project start |
| Target End Date | Date | Expected completion |
| Icon | String | Emoji or icon |

### Project Status Workflow
```
Quote → Queue → Ready → In Progress → Review → Done → Archive
```

| Status | Description | Task Visibility |
|--------|-------------|-----------------|
| Quote | Proposal stage | Hidden from Tech |
| Queue | Approved, not started | Hidden from Tech |
| Ready | Ready to begin | Visible to assignees |
| In Progress | Active work | Visible to assignees |
| Review | Final review | Visible to assignees |
| Done | Completed | Visible (read-only) |
| Archive | Closed | Hidden by default |

### Project Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Overview Tab | Status, health, milestones, team, resources | 3 |
| Tasks Tab | Tasks grouped by phase, drag-drop reorder | 3 |
| Workload Tab | Donut chart by function/person | 3 |
| Meetings Tab | Project meetings | 3 |
| Notes Tab | Project-specific notes | 8 |
| Time Tab | Time entries, budget vs. actual (PM/Admin) | 4 |
| Health Indicators | On track / At risk / Behind | 5 |
| Progress Tracking | Percentage complete | 3 |
| Team Assignments | Function → User mapping | 6 |
| Billing Milestones | Trigger-based billing events | 6 |
| Resource Links | Figma, Google Drive, etc. | 3 |

### Project List Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Search | By name | 3 |
| Filter by Status | Quote, Ready, In Progress, etc. | 3 |
| Filter by Client | Select patron | 3 |
| Filter by PM | Select project manager | 3 |
| Filter by Health | On track, At risk, Behind | 5 |
| View Toggle | List view / Card view | 3 |

---

## 6. Tasks/Quests

### Core CRUD
| Feature | Description | Phase |
|---------|-------------|-------|
| Create Task | Modal form, context-aware pre-selection | 3 |
| View Task List | Global list with filters | 3 |
| View Task Detail | Full page with tabs | 3 |
| View Task Peek | Drawer for quick view | 3 |
| Edit Task | Modal or inline | 3 |
| Soft Delete | Archive task | 3 |

### Task Properties
| Property | Type | Notes |
|----------|------|-------|
| Title | String | Required |
| Description | Text | Rich text content |
| Client | Relation | May be null for internal tasks |
| Site | Relation | Optional |
| Project | Relation | Optional (ad-hoc if null) |
| SOP | Relation | Linked procedure |
| Status | Enum | See workflow below |
| Type | Enum | Project, Ad-hoc, Support, Recurring, Internal |
| Priority | Integer | 1 (highest) to 5 (lowest) |
| Function | Relation | Job role for task |
| Assignee | Relation | Assigned user |
| Reviewer | Relation | Review user (defaults to PM) |
| Phase | String | Project phase |
| Due Date | Date | When task is due |
| Energy Impact | Decimal | Base estimate |
| Mystery Factor | Enum | None, Average, Significant, No Idea |
| Battery Impact | Enum | Low, Average, High |
| Billing Target | Decimal | Max billable hours |
| Is Billable | Boolean | Can be billed |
| Is Retainer Work | Boolean | Counts against retainer |
| No Review Required | Boolean | Skip review step |
| No Time Tracking | Boolean | Don't track time |
| Tags | Array | Categorization |

### Task Status Workflow
```
Not Started → In Progress → Blocked → Review → Done
                    ↑           ↓
                    ←───────────←  (returned)
```

| Status | Description | Next States |
|--------|-------------|-------------|
| Not Started | Awaiting work | In Progress |
| In Progress | Being worked on | Blocked, Review, Done |
| Blocked | Waiting on dependency | In Progress |
| Review | Awaiting approval | Done, In Progress (returned) |
| Done | Completed | — |

### Task Calculations
| Calculation | Formula | Notes |
|-------------|---------|-------|
| Weighted Energy | energy_impact × mystery_multiplier | Adjusted estimate |
| Energy Variance | energy_impact × variance_multiplier | Upper bound |
| Time Spent | SUM(time_entries.duration) | Actual time logged |
| Burndown % | time_spent / weighted_energy | Progress indicator |
| Is Ready | No blockers AND project visible | Can work be started |

### Mystery Factor Multipliers
| Factor | Multiplier | Variance |
|--------|------------|----------|
| None | 1.0 | 1.0 |
| Average | 1.3 | 1.5 |
| Significant | 1.5 | 1.75 |
| No Idea | 1.75 | 2.0 |

### Task Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Requirements Checklist | Sub-items within task | 3 |
| Blocking Dependencies | Task blocks/blocked by | 3 |
| Time Entries Tab | Time logged against task | 4 |
| Comments | Discussion thread | 8 |
| Activity Log | History of changes | 8 |
| Board View | Kanban-style status columns | 3 |
| Drag-Drop Status | Change status by dragging | 3 |

### Task List Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Search | By title, description | 3 |
| Filter by Status | Not Started, In Progress, etc. | 3 |
| Filter by Project | Select pact | 3 |
| Filter by Client | Select patron | 3 |
| Filter by Assignee | Select user | 3 |
| Filter by Function | Select job role | 3 |
| Filter by Type | Project, Ad-hoc, etc. | 3 |
| Filter by Priority | 1-5 | 3 |
| Group By | Phase, Status, Assignee | 3 |
| My Tasks Toggle | Show only assigned to me | 3 |

---

## 7. Requirements/Checklist (Within Tasks)

### Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Add Requirement | Inline text input | 3 |
| Edit Requirement | Inline editing | 3 |
| Delete Requirement | Remove item | 3 |
| Toggle Complete | Checkbox with optimistic update | 3 |
| Reorder | Drag-and-drop | 3 |
| Progress Display | "X of Y complete" | 3 |
| Auto-populate | Copy from SOP template | 3 |

### Requirement Properties
| Property | Type | Notes |
|----------|------|-------|
| ID | UUID | Unique identifier |
| Text | String | Requirement description |
| Completed | Boolean | Is checked |
| Completed At | Timestamp | When completed |
| Completed By | UUID | Who completed |
| Sort Order | Integer | Display order |

---

## 8. Time Tracking

### Timer Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Global Timer Widget | Visible in header when active | 4 |
| Start Timer | From task card, task detail, or header | 4 |
| Stop Timer | Creates time entry | 4 |
| Cancel Timer | Discard without saving | 4 |
| Timer Persistence | Survives page navigation | 4 |
| Timer Context | React Context for global state | 4 |
| Elapsed Display | HH:MM:SS format | 4 |

### Time Entry CRUD
| Feature | Description | Phase |
|---------|-------------|-------|
| Create (from timer) | Auto-created on stop | 4 |
| Create (manual) | Modal form | 4 |
| View Entry List | Chronicles page | 4 |
| Edit Entry | Own entries only | 4 |
| Delete Entry | Own entries only | 4 |

### Time Entry Properties
| Property | Type | Notes |
|----------|------|-------|
| Task | Relation | Required |
| User | Relation | Auto-set to current user |
| Started At | Timestamp | Timer start time |
| Ended At | Timestamp | Timer stop time |
| Duration | Integer | Minutes (calculated or manual) |
| Entry Date | Date | Date of work |
| Description | Text | Notes about work |
| Is Billable | Boolean | Can be invoiced |
| Is Manual | Boolean | Manual vs. timer entry |

### Time Views
| View | Description | Phase |
|------|-------------|-------|
| Chronicles (Daily) | Today's entries by default | 4 |
| Chronicles (Weekly) | Week selector, day breakdown | 4 |
| Task Time Tab | Entries for specific task | 4 |
| Project Time Tab | Entries for project (PM/Admin) | 4 |
| Missing Time Alerts | Days with no entries | 5 |

---

## 9. Dashboards/Overlooks

### Tech Overlook
| Section | Description | Phase |
|---------|-------------|-------|
| My Quests | Ready tasks assigned to user | 5 |
| Blocked/Upcoming | Tasks not yet ready | 5 |
| Missing Time | Days with no time entries | 5 |
| Recent Time | Entries from past 7 days | 5 |
| Active Timer | Current running timer widget | 5 |

### PM Overlook
| Section | Description | Phase |
|---------|-------------|-------|
| Focus Quests | PM's assigned tasks | 5 |
| Awaiting Review | Tasks ready for PM review | 5 |
| Unassigned Quests | Tasks needing assignment | 5 |
| Retainer Alerts | Clients at warning/exceeded | 5 |
| Project Health | Summary of project statuses | 5 |
| Active Timer | Current running timer widget | 5 |

### Admin Overlook
| Section | Description | Phase |
|---------|-------------|-------|
| All PM Features | Everything above | 5 |
| System Overview | Active pacts, open quests, team count | 5 |
| All Projects | Overview of all projects | 5 |
| Team Utilization | Hours by team member | 5 |
| System Alerts | Domain expiring, etc. | 5 |

---

## 10. SOPs/Runes

### Core CRUD
| Feature | Description | Phase |
|---------|-------------|-------|
| Create SOP | Full editor page | 7 |
| View SOP List | Paginated with filters | 7 |
| View SOP Detail | Full page with content | 7 |
| Edit SOP | TipTap rich text editor | 7 |
| Soft Delete | Archive SOP | 7 |

### SOP Properties
| Property | Type | Notes |
|----------|------|-------|
| Name | String | Required |
| Description | Text | Brief summary |
| Content | JSON | TipTap document |
| Owner Function | Relation | Responsible for updates |
| Default Function | Relation | Default for tasks using this |
| Phase | String | Default phase |
| Energy Impact | Decimal | Default estimate |
| Mystery Factor | Enum | Default mystery factor |
| Battery Impact | Enum | Default battery impact |
| Priority | Integer | Default priority |
| No Review | Boolean | Default skip review |
| Template Requirements | JSON | Checklist items to copy |
| Tags | Array | Categorization |
| Last Reviewed | Date | Review tracking |
| Review Interval Days | Integer | Days between reviews |

### SOP Features
| Feature | Description | Phase |
|---------|-------------|-------|
| TipTap Editor | Rich text with headings, lists, etc. | 7 |
| Read-Only Render | Display on task detail | 7 |
| Template Requirements | Copied to tasks on creation | 7 |
| Review Status | Current, Due Soon, Overdue | 7 |
| Function Filtering | SOPs by function | 7 |

---

## 11. Recipes/Rituals (Project Templates)

### Core CRUD
| Feature | Description | Phase |
|---------|-------------|-------|
| Create Recipe | Admin interface | 6 |
| View Recipe List | Available templates | 6 |
| View Recipe Detail | Phases and tasks | 6 |
| Edit Recipe | Modify template | 6 |
| Activate/Deactivate | Control availability | 6 |

### Recipe Properties
| Property | Type | Notes |
|----------|------|-------|
| Name | String | Required |
| Description | Text | What this template is for |
| Default Type | Enum | Project, Retainer, etc. |
| Is Active | Boolean | Available for use |
| Requires Sitemap | Boolean | Show sitemap step in wizard |

### Recipe Phase Properties
| Property | Type | Notes |
|----------|------|-------|
| Name | String | Phase name (Setup, Design, Build, etc.) |
| Sort Order | Integer | Display order |

### Recipe Task Properties
| Property | Type | Notes |
|----------|------|-------|
| Title | String | Task name (or null to use SOP name) |
| SOP | Relation | Linked SOP for defaults |
| Function | Relation | Job role override |
| Phase | Relation | Parent phase |
| Sort Order | Integer | Order within phase |
| Is Variable | Boolean | Generate per sitemap page |
| Variable Source | String | 'sitemap_page' or 'custom' |
| Is Milestone | Boolean | Approval/gate task |
| Default Billing % | Decimal | Budget percentage |

### Recipe Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Phase Organization | Tasks grouped by phase | 6 |
| Task Ordering | Sort order within phase | 6 |
| Drag-Drop Reorder | Move tasks within/between phases | 6 |
| Variable Tasks | Generate multiple from sitemap | 6 |
| SOP Linkage | Pull defaults from SOP | 6 |
| Milestone Tasks | Trigger billing events | 6 |

---

## 12. Project Creation Wizard

### Wizard Steps
| Step | Name | Description | Phase |
|------|------|-------------|-------|
| 1 | Select Recipe | Choose template or blank | 6 |
| 2 | Client & Site | Select patron and optionally site | 6 |
| 3 | Sitemap | Define pages (if recipe requires) | 6 |
| 4 | Team Assignment | Map functions to users | 6 |
| 5 | Review | Configure project details | 6 |
| 6 | Generate | Create and show estimates | 6 |

### Sitemap Input (Step 3)
| Feature | Description | Phase |
|---------|-------------|-------|
| Page List | Add pages for the site | 6 |
| Page Type | Homepage, Interior, Landing, etc. | 6 |
| Page Options | Needs mockup, needs content, etc. | 6 |
| Task Preview | Show what will be generated | 6 |

### Team Assignment (Step 4)
| Feature | Description | Phase |
|---------|-------------|-------|
| Function Grid | All functions required by recipe | 6 |
| User Selector | Assign user per function | 6 |
| Unassigned Option | Leave for later assignment | 6 |

### Generation (Step 6)
| Feature | Description | Phase |
|---------|-------------|-------|
| Phase Estimates | Energy range per phase | 6 |
| Total Estimates | Sum of all phases | 6 |
| Value Calculation | Using client rate (or $150 fallback) | 6 |
| Variable Task Creation | Generate per sitemap page | 6 |
| Team Assignment Application | Set assignees by function | 6 |

---

## 13. Reference Data Management (Admin)

### Functions
| Feature | Description | Phase |
|---------|-------------|-------|
| Full CRUD | Create, edit, delete | 2 |
| Name | Function title | 2 |
| Description | Role description | 2 |
| Is Active | Enable/disable | 2 |

### Hosting Plans
| Feature | Description | Phase |
|---------|-------------|-------|
| Full CRUD | Create, edit, delete | 2 |
| Name | Plan name | 2 |
| Client Rate | Price to direct clients | 2 |
| Agency Rate | Price to white-label partners | 2 |
| Monthly Cost | Internal cost | 2 |
| Vendor Plan | Underlying plan name | 2 |
| Profit/Margin | Calculated fields | 2 |

### Maintenance Plans
| Feature | Description | Phase |
|---------|-------------|-------|
| Full CRUD | Create, edit, delete | 2 |
| Name | Plan name | 2 |
| Client Rate | Price to clients | 2 |
| Agency Rate | Price to partners | 2 |
| Support Hours | Monthly allocation | 2 |
| Linked SOP | Maintenance procedure | 2 |

### Tools
| Feature | Description | Phase |
|---------|-------------|-------|
| Full CRUD | Create, edit, delete | 2 |
| Name | Tool name | 2 |
| Type | Plugin, Theme, Service, Software | 2 |
| Description | What it does | 2 |
| Vendor | Provider | 2 |
| License Key | Stored credential | 2 |
| URL | Tool website | 2 |

---

## 14. Notifications

### Notification System
| Feature | Description | Phase |
|---------|-------------|-------|
| Create Notifications | On relevant events | 8 |
| Notification Bundling | Group within 30-min window | 8 |
| Unread Count | Badge in header | 8 |
| Notification Panel | Dropdown list | 8 |
| Mark as Read | Individual and bulk | 8 |
| Navigate to Entity | Click to go to related item | 8 |

### Notification Types
| Event | Recipient | Phase |
|-------|-----------|-------|
| Task Assigned | Assignee | 8 |
| Task Ready (Project Activated) | Assignees (bundled) | 8 |
| Task Reassigned | New assignee, old assignee | 8 |
| Task Blocked | Project PM | 8 |
| Task Unblocked | Assignee | 8 |
| Task Submitted for Review | Reviewer | 8 |
| Task Approved | Assignee | 8 |
| Task Returned | Assignee | 8 |
| Retainer Warning | PM, Admin | 8 |
| Milestone Triggered | PM | 8 |
| Domain Expiring | Admin | 8 |

### Notification Preferences
| Feature | Description | Phase |
|---------|-------------|-------|
| Per-Type Toggles | Enable/disable by type | 8 |
| In-App Toggle | Show in notification panel | 8 |
| Email Toggle | Send email (future) | 8 |

---

## 15. Global Search

### Search Features
| Feature | Description | Phase |
|---------|-------------|-------|
| Command Palette | Cmd+K / Ctrl+K trigger | 8 |
| Type-Ahead | Search as you type | 8 |
| Debounce | Delay API calls | 8 |
| Grouped Results | By entity type | 8 |
| Breadcrumb Context | Show hierarchy | 8 |
| Keyboard Navigation | Arrow keys, Enter | 8 |
| Recent Searches | LocalStorage history | 8 |
| Role Filtering | Only show accessible items | 8 |

### Searchable Entities
| Entity | Fields Searched | Phase |
|--------|-----------------|-------|
| Clients | Name, contact | 8 |
| Sites | Name | 8 |
| Projects | Name | 8 |
| Tasks | Title | 8 |

---

## 16. User Preferences/Settings

### Preference Options
| Setting | Description | Phase |
|---------|-------------|-------|
| Naming Convention | Awesome (fantasy) vs. Standard | 8 |
| Theme | Light, Dim, Dark, System | 8 |
| Notification Preferences | Per-type toggles | 8 |

### Profile Settings
| Setting | Description | Phase |
|---------|-------------|-------|
| Name | Display name | 1 |
| Email | Login email | 1 |
| Phone | Contact phone | 1 |
| Avatar | Profile image | 1 |
| Password Change | Update password | 1 |
| Timezone | User timezone | 1 |

---

## 17. Reports

### Retainer Usage Report
| Feature | Description | Phase |
|---------|-------------|-------|
| By Client | Usage per patron | 9 |
| Period Display | Current month | 9 |
| Used vs. Allocated | Hours comparison | 9 |
| Overage Amount | Hours over limit | 9 |
| Trend | Last 3 months | 9 |
| CSV Export | Download data | 9 |

### Profitability Report
| Feature | Description | Phase |
|---------|-------------|-------|
| By Client | Revenue/cost per patron | 9 |
| By Project | Revenue/cost per pact | 9 |
| Overall | Agency-wide summary | 9 |
| Time Period Filter | Date range selection | 9 |
| Revenue | Billed amounts | 9 |
| Cost | Time × hourly cost | 9 |
| Profit/Margin | Calculated | 9 |
| CSV Export | Download data | 9 |

### Project Health Report
| Feature | Description | Phase |
|---------|-------------|-------|
| All Active Projects | List view | 9 |
| Status Column | Current project status | 9 |
| Health Column | On track / At risk / Behind | 9 |
| PM Column | Project manager | 9 |
| Next Milestone | Upcoming milestone | 9 |
| Assignees Needing Support | Blocked or struggling | 9 |
| Filter by Health | Show only at-risk | 9 |
| Filter by PM | Show PM's projects | 9 |
| CSV Export | Download data | 9 |

---

## 18. Global UI/UX Features

### Layout Components
| Component | Description | Phase |
|-----------|-------------|-------|
| Sidebar Navigation | Collapsible, role-based | 1 |
| Header Bar | Search, timer, notifications, user | 1 |
| Main Content Area | Renders pages | 1 |
| Breadcrumb Navigation | Hierarchical context | 1 |
| Toast Notifications | Action feedback | 1 |

### Interaction Patterns
| Pattern | Description | Phase |
|---------|-------------|-------|
| Peek Drawers | Quick view without leaving | 3 |
| Modal Forms | Create/edit overlays | 2 |
| Confirmation Dialogs | Destructive action warnings | 2 |
| Loading Skeletons | Content placeholders | 2 |
| Empty States | Helpful when no data | 2 |
| Error Boundaries | Graceful error handling | 2 |
| Optimistic Updates | Instant UI feedback | 3 |

### Keyboard Shortcuts
| Shortcut | Action | Phase |
|----------|--------|-------|
| Cmd+K / Ctrl+K | Global search | 8 |
| Cmd+N / Ctrl+N | New task | 8 |
| Cmd+\ / Ctrl+\ | Toggle sidebar | 1 |
| Escape | Close modal/drawer | 1 |
| Arrow Keys | Navigate search results | 8 |

### Accessibility
| Feature | Description | Phase |
|---------|-------------|-------|
| Focus Management | Proper focus order | 8 |
| Keyboard Navigation | All interactive elements | 8 |
| Screen Reader Labels | ARIA labels | 8 |
| Color Contrast | WCAG compliance | 8 |

### Mobile Responsive
| Feature | Description | Phase |
|---------|-------------|-------|
| Bottom Tab Bar | Primary navigation | 1 |
| Simplified Header | Condensed for mobile | 1 |
| Touch-Friendly | Larger tap targets | 1 |

---

## 19. Notes & Comments

### Notes
| Feature | Description | Phase |
|---------|-------------|-------|
| Attach to Patron | Client-level notes | 8 |
| Attach to Site | Site-level notes | 8 |
| Attach to Project | Project-level notes | 8 |
| Roll-Up Display | Show child notes on parent | 8 |
| Source Context | "Added on: [entity]" | 8 |
| Rich Text | Formatted content | 8 |

### Comments (on Tasks)
| Feature | Description | Phase |
|---------|-------------|-------|
| Add Comment | Text entry | 8 |
| View Thread | Chronological list | 8 |
| Review Feedback | PM comments on returned tasks | 8 |

---

## 20. Meetings

### Meeting Features (MVP Placeholder)
| Feature | Description | Phase |
|---------|-------------|-------|
| Create Meeting | Link to client/project | 3 |
| Meeting Date/Time | When it occurred | 3 |
| Attendees | Internal attendees | 3 |
| Meeting Link | Video call URL | 3 |
| Recording Link | Recording URL | 3 |
| Transcript | Attached file | 3 |

---

## 21. Phase Coverage Matrix

| Feature Area | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 | Phase 7 | Phase 8 | Phase 9 | Phase 10 |
|--------------|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:--------:|
| Auth & Users | ✅ | ✅ | | | | | | | | |
| Clients | | ✅ | | | | | | | | |
| Sites | | ✅ | | | | | | | | |
| Domains | | ✅ | | | | | | | | |
| Reference Data | | ✅ | | | | | | | | |
| Projects | | | ✅ | | | | | | | |
| Tasks | | | ✅ | | | | | | | |
| Time Tracking | | | | ✅ | | | | | | |
| Dashboards | | | | | ✅ | | | | | |
| Recipes | | | | | | ✅ | | | | |
| Wizard | | | | | | ✅ | | | | |
| SOPs | | | | | | | ✅ | | | |
| Notifications | | | | | | | | ✅ | | |
| Search | | | | | | | | ✅ | | |
| Preferences | | | | | | | | ✅ | | |
| Reports | | | | | | | | | ✅ | |
| Testing | | | | | | | | | | ✅ |
| Deployment | | | | | | | | | | ✅ |

---

## 22. Gaps & Second Pass Items

### From Memory: Second Pass List
These items were flagged for review and should be verified against phase documents:

| Item | Status | Notes |
|------|--------|-------|
| Entity editing robustness | ⚠️ Review | Ensure all edit forms handle edge cases |
| "Prospect" status | ⚠️ Review | Not in current client status enum |
| "Never Again" status | ✅ Covered | In client status enum |
| Site client editing | ⚠️ Review | Can site be moved to different client? |
| Domain site/client editing | ⚠️ Review | Can domain be moved to different site? |
| Count summaries | ⚠️ Review | Ensure all list views show counts |

### Potential Gaps Identified

| Feature | Status | Notes |
|---------|--------|-------|
| Recurring Tasks | ⚠️ Unclear | Schema exists but no dedicated phase coverage |
| Activity Logging | ⚠️ Unclear | API exists but no dedicated UI |
| Bulk Operations | ❌ Deferred | Explicitly marked "none for MVP" |
| Email Notifications | ❌ Deferred | Toggle exists but marked "future" |
| Client Portal | ❌ Deferred | Listed as future feature |
| QuickBooks Integration | ❌ Deferred | Listed as future feature |
| Slack Integration | ❌ Deferred | Listed as future feature |

### Recommendations

1. **Recurring Tasks:** Add explicit coverage to Phase 6 or create Phase 6.5
2. **Activity Logging:** Add to Phase 8 or mark as post-MVP
3. **Prospect Status:** Decide if needed and add to client status enum
4. **Entity Reassignment:** Document whether sites can change clients, domains can change sites
5. **Count Summaries:** Add to Phase 2 acceptance criteria

---

## Appendix: Fantasy Terminology Reference

| Standard Term | Fantasy Term | Used In |
|---------------|--------------|---------|
| Dashboard | Overlook | Navigation, Pages |
| Client | Patron | Throughout |
| Project | Pact | Throughout |
| Task | Quest | Throughout |
| SOP | Rune | Navigation, Pages |
| Recipe | Ritual | Navigation, Pages |
| Time Tracking | Chronicles | Navigation |
| Settings | Guild | Navigation |
| Clients Section | Foundry | Navigation |
| Knowledge Section | Grimoire | Navigation |
| Services Section | Armory | Navigation |