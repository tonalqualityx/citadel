# Indelible Project Management System
## Database Architecture & Requirements Specification

**Version:** 1.0  
**Date:** December 2024  
**Target Launch:** January/February 2025

---

## Executive Summary

This document defines the database architecture and requirements for Indelible's custom project management web application, replacing the current Notion-based "Vault of Insanity" system. The application will serve a web development agency managing clients, projects, tasks, time tracking, and operational procedures.

### Key Improvements Over Current System
1. **Better Templating** â€” SOPs and Task Templates unified; changes propagate automatically
2. **Better Relationships** â€” Automatic inheritance (Site â†’ Client â†’ Agency Partner)
3. **Better One-Click Setup** â€” Project wizard generates tasks from Recipes + sitemap
4. **Better Client Management** â€” Unified client model with white-label support

### Technology Stack
- **Backend:** Node.js (API-first design)
- **Frontend:** React with TipTap (block editor), dnd-kit (drag-and-drop)
- **Database:** PostgreSQL (recommended for relational integrity)
- **Hosting:** Cloudways/Digital Ocean or AWS

---

## Entity Relationship Diagram

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                           INDELIBLE SYSTEM ARCHITECTURE                          â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

                                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                    â”‚    CLIENT    â”‚
                                    â”‚ (Direct/Agencyâ”‚
                                    â”‚  /Sub-Client) â”‚
                                    â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                           â”‚
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
              â”‚                            â”‚                            â”‚
              â–¼                            â–¼                            â–¼
      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
      â”‚    SITES     â”‚            â”‚   PROJECTS   â”‚            â”‚   MEETINGS   â”‚
      â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜            â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
             â”‚                           â”‚
    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”                  â”‚
    â”‚        â”‚        â”‚                  â”‚
    â–¼        â–¼        â–¼                  â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚HOSTING â”‚ â”‚DOMAINS â”‚ â”‚  MAINT  â”‚  â”‚    TASKS     â”‚
â”‚ PLANS  â”‚ â”‚        â”‚ â”‚ PLANS   â”‚  â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
â””â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜         â”‚
                                          â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚                     â”‚                     â”‚
                    â–¼                     â–¼                     â–¼
            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
            â”‚  TIME ENTRY  â”‚      â”‚     SOPs     â”‚      â”‚  FUNCTIONS   â”‚
            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â”‚(Task Templates)â”‚     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

SUPPORTING: Users, Recipes, Tools, Notifications
```

---

## Core Entities

### 1. Client

Central entity for managing all client relationships.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| business_name | String | Yes | Company/client name |
| type | Enum | Yes | `direct`, `agency_partner`, `sub_client` |
| parent_agency_id | UUID | No | FK to Client (if sub_client) |
| contact_person | String | No | Primary contact name |
| email | String | No | Contact email |
| phone | String | No | Contact phone |
| status | Enum | Yes | `active`, `inactive`, `delinquent`, `never_again` |
| hourly_rate | Decimal | No | Default billing rate (PM/Admin only) |
| retainer_hours | Decimal | No | Monthly retainer allocation |
| quickbooks_id | String | No | Future: QB customer mapping |
| icon | String | No | Emoji or image reference |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Computed Fields:**
- `retainer_used` â€” Sum of task energy for current month (retainer work)
- `retainer_available` â€” retainer_hours - retainer_used
- `payment_status` â€” From QuickBooks integration (future)

**Relationships:**
- Has many Sites
- Has many Projects
- Has many Meetings
- Has many Sub-Clients (if agency_partner)
- Belongs to Parent Agency (if sub_client)

---

### 2. Site

Websites managed by Indelible.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Primary domain or identifier |
| url | String | No | Live site URL |
| client_id | UUID | Yes | FK to Client |
| hosting_plan_id | UUID | No | FK to Hosting Plan |
| maintenance_plan_id | UUID | No | FK to Maintenance Plan |
| webmaster_id | UUID | No | FK to User (for maintenance tasks) |
| platform | Enum | No | `wpmu_dev`, `cloudways`, `godaddy`, `other` |
| hosted_by | Enum | No | `indelible`, `client` |
| icon | String | No | Emoji or image reference |
| notes | Text | No | Quick notes (block editor) |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Relationships:**
- Belongs to Client
- Has one Hosting Plan
- Has one Maintenance Plan
- Has many Domains
- Has many Projects
- Has many Tasks

**Inheritance Logic:**
When a Task is created for a Site, it automatically inherits:
- client_id
- Agency Partner (via client.parent_agency_id)
- Billing rate (via client.hourly_rate)
- Retainer status (via client.retainer_hours)

---

### 3. Domain

Domain tracking for sites.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Domain name (e.g., example.com) |
| site_id | UUID | Yes | FK to Site |
| registrar | String | No | Where domain is registered |
| dns_provider | String | No | Where DNS is managed |
| account_owner | String | No | Whose account it's under |
| expiration_date | Date | No | Domain expiration |
| ssl_expiration | Date | No | SSL certificate expiration |
| notes | Text | No | |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

---

### 4. Project

Website projects from quote through completion.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Project name |
| client_id | UUID | Yes | FK to Client |
| site_id | UUID | No | FK to Site |
| recipe_id | UUID | No | FK to Recipe (template used) |
| status | Enum | Yes | See Status Options below |
| pm_id | UUID | No | FK to User (Project Manager) |
| budget | Decimal | No | Total project budget (PM/Admin) |
| is_retainer_work | Boolean | Yes | Default true; draws from client retainer |
| start_date | Date | No | Project start |
| target_end_date | Date | No | Expected completion |
| figma_url | String | No | Design file link |
| drive_url | String | No | Google Drive folder |
| content_strategy_url | String | No | Content strategy doc |
| technical_strategy_url | String | No | Technical strategy doc |
| contract_url | String | No | Contract link (PM/Admin only) |
| cover_image | String | No | Cover image URL |
| icon | String | No | Emoji or image reference |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Status Options:** `quote`, `queue`, `ready`, `in_progress`, `review`, `suspended`, `done`, `abandoned`

**Computed Fields:**
- `progress` â€” % of task energy completed vs total
- `health_status` â€” `on_track`, `at_risk`, `behind` (milestone-based)
- `total_energy` â€” Sum of task energy estimates
- `energy_spent` â€” Sum of completed task energy
- `time_spent` â€” Sum of time entries

**Relationships:**
- Belongs to Client
- Belongs to Site (optional)
- Belongs to Recipe (optional)
- Has many Tasks
- Has many Milestones
- Has many Meetings
- Has many Team Assignments

---

### 5. Project Team Assignment

Maps Functions to Users at the project level.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| project_id | UUID | Yes | FK to Project |
| function_id | UUID | Yes | FK to Function |
| user_id | UUID | Yes | FK to User |
| created_at | Timestamp | Yes | |

**Purpose:** When tasks are created with a Function, the system auto-assigns the User mapped to that Function for this Project.

---

### 6. Milestone

Project billing milestones.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| project_id | UUID | Yes | FK to Project |
| name | String | Yes | Milestone name (e.g., "Design Approval") |
| amount | Decimal | Yes | Dollar amount |
| trigger_type | Enum | Yes | `manual`, `phase_complete`, `task_complete` |
| trigger_phase | String | No | Phase name (if phase_complete) |
| trigger_task_id | UUID | No | FK to Task (if task_complete) |
| target_date | Date | No | Expected due date |
| status | Enum | Yes | `pending`, `triggered`, `invoiced`, `paid` |
| invoice_id | String | No | QuickBooks invoice ID (future) |
| triggered_at | Timestamp | No | When milestone was triggered |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

---

### 7. Task

Central task management entity.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| task_number | Serial | Yes | Auto-increment ID for reference |
| name | String | Yes | Task name |
| status | Enum | Yes | See Status Options below |
| project_id | UUID | No | FK to Project |
| site_id | UUID | No | FK to Site |
| client_id | UUID | Yes | FK to Client (inherited or direct) |
| assignee_id | UUID | No | FK to User |
| reviewer_id | UUID | No | FK to User (defaults to project PM) |
| sop_id | UUID | No | FK to SOP (template used) |
| phase | String | No | Phase name (from recipe) |
| function_id | UUID | No | FK to Function |
| type | Enum | Yes | `project`, `ad_hoc`, `support`, `recurring`, `internal` |
| priority | Enum | Yes | `low`, `medium`, `high`, `urgent` |
| due_date | Date | No | Task deadline |
| url | String | No | Page URL (for site-specific tasks) |
| cover_image | String | No | Cover image URL |
| icon | String | No | Emoji or image reference |

**Energy & Estimation:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| energy_impact | Decimal | No | Base effort estimate (hours) |
| mystery_factor | Enum | No | `none`, `average`, `significant`, `no_idea` |
| battery_impact | Enum | No | `average_drain`, `high_drain`, `energizing` |

**Billing:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| is_billable | Boolean | Yes | Default true |
| is_retainer_work | Boolean | Yes | Draws from client retainer |
| billing_target | Enum | No | `low`, `average`, `high` |
| approved | Boolean | Yes | Approved by reviewer |
| invoiced | Boolean | Yes | Included in invoice |

**Workflow:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| no_review | Boolean | Yes | Skip review (from SOP template) |
| no_time_tracking | Boolean | Yes | Skip time tracking |
| focus | Boolean | Yes | In user's focus list |
| blocked_reason | Text | No | Why task is manually blocked |
| date_complete | Timestamp | No | When marked done |

**Content:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| content | JSON | No | Block editor content (checklist, notes) |
| tags | String[] | No | Tag array |

**Timestamps:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Status Options:** `not_started`, `in_progress`, `blocked`, `review`, `done`, `abandoned`

**Status Flow:**
```
not_started â†’ in_progress â†’ done (if no_review) 
                         â†’ review â†’ done (if requires review)
                         
Any status can â†’ blocked (requires reason)
blocked â†’ previous status (when unblocked)
```

**Computed Fields:**
- `weighted_energy` â€” energy_impact Ã— mystery_factor_multiplier
- `energy_variance` â€” Upper bound estimate
- `time_range` â€” Formatted "X hrs â€” Y hrs"
- `time_spent` â€” Sum of time entries
- `amount_to_bill` â€” weighted_energy Ã— client.hourly_rate
- `is_ready` â€” No incomplete blockers AND assigned AND project is active
- `burndown` â€” time_spent / weighted_energy (visual indicator)

**Relationships:**
- Belongs to Project (optional)
- Belongs to Site (optional)
- Belongs to Client
- Belongs to SOP (optional)
- Belongs to Function (optional)
- Belongs to Assignee (User)
- Belongs to Reviewer (User)
- Has many Time Entries
- Has many Comments
- Has many Blocking Tasks (self-reference)
- Has many Blocked By Tasks (self-reference)

---

### 8. Task Dependency

Self-referencing task blockers.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| blocking_task_id | UUID | Yes | FK to Task (the blocker) |
| blocked_task_id | UUID | Yes | FK to Task (the blocked) |
| created_at | Timestamp | Yes | |

**Constraint:** Both tasks must belong to same project (enforced in app logic)

---

### 9. Recurring Task Definition

Defines recurring task patterns.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| task_template_id | UUID | Yes | FK to SOP (template for generated tasks) |
| site_id | UUID | No | FK to Site (for maintenance tasks) |
| project_id | UUID | No | FK to Project (for project recurring) |
| frequency | Enum | Yes | `daily`, `weekly`, `monthly`, `quarterly`, `yearly` |
| interval | Integer | Yes | Every N periods |
| day_of_month | Integer | No | For monthly (e.g., 1 = 1st of month) |
| day_of_week | Integer | No | For weekly (0=Sun, 6=Sat) |
| due_day_of_month | Integer | No | When task is due (e.g., 23) |
| scope | Enum | Yes | `project`, `phase`, `indefinite` |
| end_phase | String | No | Stop when this phase completes |
| end_date | Date | No | Stop after this date |
| is_active | Boolean | Yes | Currently generating tasks |
| last_generated | Date | No | Last task creation date |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

---

### 10. SOP (Standard Operating Procedure / Task Template)

Unified SOP + Task Template entity.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | SOP/Template name |
| description | Text | No | Brief description |
| owner_function_id | UUID | No | FK to Function (responsible for updates) |
| phase | String | No | Default phase for tasks |
| function_id | UUID | No | Default function for tasks |
| energy_impact | Decimal | No | Default estimate |
| mystery_factor | Enum | No | Default mystery factor |
| battery_impact | Enum | No | Default battery impact |
| priority | Enum | No | Default priority |
| estimated_duration | Decimal | No | Estimated hours to complete |
| no_review | Boolean | Yes | Default: tasks skip review |
| tags | String[] | No | Tag array |
| checklist | JSON | Yes | Checklist items (copied to task content) |
| documentation | JSON | Yes | Rich documentation (stays in SOP) |
| last_reviewed | Date | No | Last review date |
| review_interval_days | Integer | No | Days between reviews (default 365) |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Computed Fields:**
- `next_review` â€” last_reviewed + review_interval_days
- `review_status` â€” `current`, `due_soon`, `overdue`

**Relationships:**
- Belongs to Owner Function
- Belongs to Default Function
- Has many Tasks (created from template)
- Has many Tool References

---

### 11. SOP Tool Reference

Links tools to SOPs for auto-embedding.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| sop_id | UUID | Yes | FK to SOP |
| tool_id | UUID | Yes | FK to Tool |
| context | Text | No | How tool is used in this SOP |
| created_at | Timestamp | Yes | |

---

### 12. Recipe

Project blueprints/templates.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Recipe name |
| description | Text | No | Brief description |
| phases | JSON | Yes | Ordered array of phase definitions |
| documentation | JSON | Yes | Rich documentation (block editor) |
| trigger_description | Text | No | What initiates this recipe |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Phases JSON Structure:**
```json
{
  "phases": [
    {
      "name": "Setup",
      "order": 1,
      "icon": "âš™ï¸"
    },
    {
      "name": "Content & Strategy", 
      "order": 2,
      "icon": "âœï¸"
    }
  ]
}
```

**Relationships:**
- Has many Recipe Tasks
- Has many Projects (created from recipe)

---

### 13. Recipe Task

Task templates within a recipe.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| recipe_id | UUID | Yes | FK to Recipe |
| sop_id | UUID | No | FK to SOP (template to use) |
| name | String | Yes | Task name (may include variables) |
| phase | String | Yes | Phase this task belongs to |
| order | Integer | Yes | Order within phase |
| task_type | Enum | Yes | `simple`, `variable`, `recurring` |
| variable_config | JSON | No | For variable tasks (see below) |
| recurring_config | JSON | No | For recurring tasks |
| dependencies | String[] | No | Names of tasks this blocks on |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Variable Config Structure:**
```json
{
  "type": "per_page",
  "name_template": "{{page_type}} Mockup: {{page_name}}",
  "filter": {
    "needs_mockup": true
  },
  "creates_dependency_for": "build_tasks"
}
```

---

### 14. Function

Job roles/skills for assignment.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Function name |
| description | Text | No | Role description |
| level | Integer | No | Seniority level (1-5) |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Example Functions:**
- Project Manager (Level 3)
- Customer Success Manager (Level 2)
- Design II (Level 2)
- Wordpress Tech II (Level 2)
- Wordpress Tech III (Level 3)
- Network Admin (Level 3)

---

### 15. Time Entry

Time tracking for tasks.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| task_id | UUID | No | FK to Task (null for internal time) |
| user_id | UUID | Yes | FK to User |
| notes | Text | No | Description of work |
| clock_in | Timestamp | No | Start time (for timer) |
| clock_out | Timestamp | No | End time (for timer) |
| manual_hours | Decimal | No | Manually entered hours |
| entry_date | Date | Yes | Date of entry |
| invoiced | Boolean | Yes | Included in invoice |
| not_billable | Boolean | Yes | Mark as non-billable |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Computed Fields:**
- `calculated_hours` â€” (clock_out - clock_in) OR manual_hours
- `to_bill` â€” calculated_hours Ã— task.client.hourly_rate (if billable)

---

### 16. Meeting

Meeting tracking.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Meeting title |
| date | Timestamp | Yes | Meeting date/time |
| client_id | UUID | No | FK to Client |
| project_id | UUID | No | FK to Project |
| site_id | UUID | No | FK to Site |
| meeting_url | String | No | Video call link |
| recording_url | String | No | Recording link (external) |
| transcript | Text | No | Transcript content (for AI indexing) |
| attendees | UUID[] | No | Array of User IDs |
| notes | JSON | No | Meeting notes (block editor) |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

---

### 17. Hosting Plan

Hosting plan definitions.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Plan name |
| client_rate | Decimal | Yes | What client pays |
| agency_rate | Decimal | No | White-label partner rate |
| monthly_cost | Decimal | Yes | Indelible's cost |
| vendor_plan | String | No | Underlying vendor plan name |
| details | Text | No | Plan details |
| tags | String[] | No | Tags (e.g., "secret_menu") |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Computed Fields:**
- `profit` â€” client_rate - monthly_cost
- `margin` â€” profit / client_rate
- `wl_profit` â€” agency_rate - monthly_cost
- `wl_margin` â€” wl_profit / agency_rate

---

### 18. Maintenance Plan

Maintenance plan definitions.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Plan name |
| client_rate | Decimal | Yes | Monthly rate |
| agency_rate | Decimal | No | White-label partner rate |
| support_cap_hours | Decimal | Yes | Default 1.0 â€” free support hours |
| sop_id | UUID | No | FK to SOP (for monthly tasks) |
| details | Text | No | Plan details |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

---

### 19. Tool

Software tools and licenses.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Tool name |
| license_key | String | No | License key (encrypted) |
| file_url | String | No | Download file location |
| tool_type | Enum | No | `plugin`, `theme`, `service`, `software` |
| description | Text | No | What it's used for |
| vendor_url | String | No | Vendor website |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

---

### 20. User

System users.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| email | String | Yes | Login email (unique) |
| name | String | Yes | Display name |
| role | Enum | Yes | `admin`, `pm`, `tech` |
| avatar_url | String | No | Profile photo |
| phone | String | No | Phone number |
| timezone | String | No | IANA timezone |
| start_date | Date | No | Employment start (for velocity) |
| weekly_availability | Decimal | No | Hours available per week |
| hourly_cost | Decimal | No | What Indelible pays (Admin only) |
| notification_preferences | JSON | No | Notification settings |
| is_active | Boolean | Yes | Account active |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

**Relationships:**
- Has many Function Assignments
- Has many Tasks (assigned)
- Has many Tasks (reviewer)
- Has many Time Entries
- Has many Projects (as PM)

---

### 21. User Function

Maps users to functions they can perform.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| user_id | UUID | Yes | FK to User |
| function_id | UUID | Yes | FK to Function |
| is_primary | Boolean | Yes | Primary function for this user |
| created_at | Timestamp | Yes | |

---

### 22. Comment

Comments on tasks.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| task_id | UUID | Yes | FK to Task |
| user_id | UUID | Yes | FK to User (author) |
| content | Text | Yes | Comment content |
| mentions | UUID[] | No | Array of mentioned User IDs |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

---

### 23. Activity Log

Audit trail for entities.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| entity_type | String | Yes | `task`, `project`, `client`, etc. |
| entity_id | UUID | Yes | FK to entity |
| user_id | UUID | Yes | FK to User who made change |
| action | String | Yes | `created`, `updated`, `deleted` |
| field_name | String | No | Which field changed |
| old_value | Text | No | Previous value |
| new_value | Text | No | New value |
| created_at | Timestamp | Yes | |

**Visibility:** PM and Admin only

---

### 24. Notification

In-app notifications.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| user_id | UUID | Yes | FK to User (recipient) |
| type | Enum | Yes | See Notification Types below |
| title | String | Yes | Notification title |
| message | Text | No | Notification body |
| entity_type | String | No | Related entity type |
| entity_id | UUID | No | Related entity ID |
| is_read | Boolean | Yes | Has been read |
| created_at | Timestamp | Yes | |

**Notification Types:**
- `task_assigned`
- `task_ready` (blockers cleared)
- `task_commented`
- `task_mentioned`
- `task_returned` (sent back for changes)
- `task_review_ready`
- `task_unblocked`
- `retainer_warning` (80% used)
- `retainer_exceeded`
- `support_cap_hit`
- `milestone_triggered`

---

### 25. Note

Notes attached to entities.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| entity_type | Enum | Yes | `client`, `project`, `site` |
| entity_id | UUID | Yes | FK to entity |
| user_id | UUID | Yes | FK to User (author) |
| content | JSON | Yes | Block editor content |
| created_at | Timestamp | Yes | |
| updated_at | Timestamp | Yes | |

---

## Role-Based Permissions

### Permission Matrix

| Capability | Tech | PM | Admin |
|------------|:----:|:--:|:-----:|
| View/execute assigned tasks | âœ… | âœ… | âœ… |
| Track time | âœ… | âœ… | âœ… |
| See all clients (no rates) | âœ… | âœ… | âœ… |
| See all projects (no budgets) | âœ… | âœ… | âœ… |
| See Tools & license keys | âœ… | âœ… | âœ… |
| Create ad-hoc tasks | âŒ | âœ… | âœ… |
| Manage own projects | âŒ | âœ… | âœ… |
| See billing for own projects | âŒ | âœ… | âœ… |
| Review tasks | âŒ | âœ… | âœ… |
| Create/edit SOPs & Recipes | âŒ | âœ… | âœ… |
| See activity history | âŒ | âœ… | âœ… |
| See all billing/rates | âŒ | âŒ | âœ… |
| See profitability reports | âŒ | âŒ | âœ… |
| Create users | âŒ | âŒ | âœ… |
| System settings | âŒ | âŒ | âœ… |
| See contract links | âŒ | âœ… | âœ… |

---

## Key Automations

### 1. Task Inheritance

When a task is created for a **Site**:
```
task.client_id = site.client_id
task.is_retainer_work = site.client.retainer_hours > 0
```

When a task is created for a **Project**:
```
task.client_id = project.client_id
task.site_id = project.site_id
task.reviewer_id = project.pm_id
task.is_retainer_work = project.is_retainer_work
```

### 2. Task Assignment

When a task is created with a **function_id** in a **Project**:
```
assignment = project_team_assignments.find(function_id)
if assignment:
    task.assignee_id = assignment.user_id
```

### 3. Review Flow

When task status changes to `done`:
```
if task.no_review:
    status stays 'done'
else:
    task.status = 'review'
    notify(task.reviewer_id, 'task_review_ready')
```

When reviewer marks `approved = true`:
```
task.status = 'done'
task.date_complete = now()
```

### 4. Blocked Status

When task status changes to `blocked`:
```
require(task.blocked_reason is not empty)
notify(project.pm_id, 'task_blocked')
```

### 5. Dependency Resolution

When a blocking task is marked `done`:
```
for each blocked_task in task.blocking:
    if all blocked_task.blocked_by are done:
        notify(blocked_task.assignee_id, 'task_unblocked')
```

### 6. Retainer Monitoring

On time entry creation:
```
client = task.client
if client.retainer_hours > 0:
    usage = calculate_retainer_usage(client, current_month)
    if usage >= client.retainer_hours * 0.8 and not already_notified:
        notify(project.pm_id, 'retainer_warning')
    if usage > client.retainer_hours and not already_notified:
        notify(project.pm_id, 'retainer_exceeded')
```

### 7. Support Cap Monitoring

For tasks with `type = 'support'`:
```
cap = site.support_cap_override OR site.maintenance_plan.support_cap_hours
if task.time_spent >= cap:
    notify(project.pm_id, 'support_cap_hit')
```

### 8. Maintenance Task Generation

On 1st of each month (or when maintenance plan assigned):
```
for each site with maintenance_plan:
    if site.maintenance_plan.sop_id:
        create task from SOP
        task.assignee_id = site.webmaster_id
        task.due_date = current_month day 23
        task.type = 'recurring'
```

When maintenance plan changes:
```
delete incomplete maintenance tasks for site
create new task from new plan's SOP
```

### 9. Project Health Calculation

```
for each upcoming milestone:
    remaining_energy = sum(incomplete task estimates before milestone)
    
    for each assignee with tasks before milestone:
        velocity = calculate_velocity(assignee)  # 3-month avg or 75% availability
        their_remaining = sum(their incomplete tasks)
        days_needed = their_remaining / (velocity / 7)  # Convert weekly to daily
        
        if days_needed > days_until_milestone:
            milestone.at_risk = true
            flag assignee as needing support

if milestone.due_date < today and incomplete tasks exist:
    milestone.status = 'behind'
```

### 10. Velocity Calculation

```
def calculate_velocity(user):
    if user.start_date > 3_months_ago:
        # New user: use 75% of availability
        return user.weekly_availability * 0.75
    
    completed_energy = sum(
        task.weighted_energy 
        for task in user.completed_tasks 
        where task.date_complete > 3_months_ago
    )
    weeks = weeks_since(max(user.start_date, 3_months_ago))
    
    if weeks < 4:
        return user.weekly_availability * 0.75
    
    return completed_energy / weeks
```

---

## Views & Dashboards

### Tech Dashboard
- My Tasks (Ready only, grouped by priority/due date)
- Blocked/Upcoming Tasks (separate section)
- Missing Time Entries
- My Time Entries (this month / last month)
- Recently Viewed
- Active Timer widget

### PM Dashboard
- Focus Tasks
- Tasks Awaiting Review (grouped by client)
- My Projects (with health indicators)
- Recently Viewed
- Active Timer widget

### Admin Dashboard
- Everything PMs see, plus:
- All Projects overview
- Retainer Status (all clients)
- Profitability summary

### Project Views
- Overview (status, health, milestones, resources)
- Tasks (grouped by phase, drag-drop reorder)
- Workload (visual by function/person)
- Meetings
- Notes
- Time (PM/Admin)

### Client Views
- Detail (status, contact, sites, retainer, payment)
- Projects (active / history)
- Meetings
- Notes
- Billing (PM/Admin)

### Site Views
- Detail (basic info, domains, webmaster)
- Projects (active / history)
- Maintenance History
- Notes

---

## MVP Reports

### 1. Retainer Usage Report
- By client
- Current month usage vs. allocation
- Overage amounts
- Trend (last 3 months)

### 2. Profitability Report
- By client / by project / overall
- Time period filter
- Revenue (billed amounts)
- Cost (time Ã— hourly cost)
- Margin

### 3. Project Health Report
- All active projects
- Status: on track / at risk / behind
- Upcoming milestones
- Assignees needing support

---

## Future Features (Not MVP)

### Integrations
- [ ] QuickBooks (invoicing, payments, customer sync)
- [ ] Proposify replacement (proposals, e-signatures)
- [ ] Slack notifications
- [ ] Email notifications

### Features
- [ ] Client dashboard / portal
- [ ] White-label partner dashboard
- [ ] Team workload visualization
- [ ] Saved custom views/filters
- [ ] Custom field admin (add/remove fields)
- [ ] Content Strategy tool with AI
- [ ] Research database
- [ ] Load balancing for assignments
- [ ] PDF report exports
- [ ] Revenue reports
- [ ] Team utilization reports
- [ ] Support ticket volume reports

---

## Data Migration Plan

### Migrate (All)
- Clients
- Sites
- Domains
- Hosting Plans
- Maintenance Plans
- SOPs
- Recipes
- Tools
- Functions

### Migrate (Selective)
- Active Projects only
- Team/Users

### Do Not Migrate
- Historical tasks
- Time entries
- Completed projects (archive in Notion)

### Cutover
- Target: January 1 or February 1, 2025
- Clean month boundary for time tracking

---

## Technical Notes

### API-First Design
Build API endpoints first to enable:
- Future Chrome extension for time tracking
- Future mobile app
- Future client portal
- Slack/webhook integrations

### Block Editor
Use TipTap with custom extensions for:
- Headings (H1, H2, H3)
- Paragraphs
- Checklists (with completion tracking)
- File attachments
- Tool embeds (auto-populate license keys)

### Search
Global search with contextual breadcrumbs:
- Client > Project > Task
- Client > Site > Task

### Keyboard Shortcuts
- `Cmd+K` â€” Global search
- `Cmd+N` â€” New task
- (More TBD)

### Performance
- Support 20 concurrent users
- Polling-based notifications (1-minute interval)
- Lazy load large lists

---

## Appendix: Mystery Factor Multipliers

| Mystery Factor | Multiplier | Variance |
|----------------|------------|----------|
| None | 1.0 | 1.0 |
| Average | 1.3 | 1.5 |
| Significant | 1.5 | 1.75 |
| No Idea | 1.75 | 2.0 |

**Calculations:**
- `weighted_energy` = energy_impact Ã— multiplier
- `energy_variance` = energy_impact Ã— variance (upper bound)
- `time_range` = energy_impact â€” energy_variance

**Billing:**
- Retainer work: Use energy_variance (high end)
- Hourly work: Use actual time spent or weighted_energy
