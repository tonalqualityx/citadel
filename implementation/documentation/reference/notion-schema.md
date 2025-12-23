# Indelible Notion Schema

## Overview

This document outlines the complete database schema for Indelible's project management system in Notion, housed within the "Vault of Insanity" workspace. The system is designed for a web development agency managing clients, projects, tasks, time tracking, and operational procedures.

---

## Database Architecture

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              INDELIBLE NOTION SCHEMA                             │
└─────────────────────────────────────────────────────────────────────────────────┘

                                    ┌──────────────┐
                                    │   CLIENTS    │
                                    │     🧑‍🚀      │
                                    └──────┬───────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
            ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
            │    SITES     │      │   PROJECTS   │      │   MEETINGS   │
            │      🕸️      │      │      🚧      │      │      🗣️      │
            └──────┬───────┘      └──────┬───────┘      └──────────────┘
                   │                     │
    ┌──────────────┼──────────────┐      │
    │              │              │      │
    ▼              ▼              ▼      ▼
┌────────┐  ┌──────────┐  ┌─────────┐  ┌──────────────┐
│HOSTING │  │ DOMAINS  │  │  MAINT  │  │    TASKS     │
│   🤖   │  │    🔗    │  │  PLANS  │  │      ✅      │
└────────┘  └──────────┘  │   🔧    │  └──────┬───────┘
                          └─────────┘         │
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
            ┌──────────────┐          ┌──────────────┐          ┌──────────────┐
            │  TIMECLOCK   │          │     SOPs     │          │  FUNCTIONS   │
            │      ⏲️      │          │      📋      │          │      💼      │
            └──────────────┘          └──────────────┘          └──────────────┘

SUPPORTING DATABASES:
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   RECIPES    │  │    NOTES     │  │    TEAM      │  │   AGENCY     │
│     🧑‍🍳      │  │      📝      │  │      👥      │  │  PARTNERS 📇 │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

---

## Core Databases

### 1. 🧑‍🚀 Clients

**Purpose:** Central CRM for managing client relationships, contact information, and billing rates.

| Property | Type | Description |
|----------|------|-------------|
| `Business` | Title | Client/company name |
| `Contact Person` | Text | Primary contact name |
| `Email Address` | Email | Contact email |
| `Phone Number` | Phone | Contact phone |
| `Client Status` | Select | Active, Inactive, Never Again, Delinquent |
| `Hourly Rate` | Number ($) | Default billing rate |
| `Maint. Hrs.` | Number | Monthly maintenance hours allocation |
| `Contact Indicators` | Text | Communication preferences/notes |
| `☑️ Tasks` | Relation → Tasks | All tasks for this client |
| `🗣️ Meetings` | Relation → Meetings | All meetings with this client |
| `Portal Affiliations` | Relation → Portal Affiliations | Partner portal connections |

**Formulas:**
- `Available` - Calculates available maintenance hours
- `Hrs Complete` - Tracks completed hours
- `On Deck` - Shows upcoming work queue

---

### 2. 🕸️ Sites

**Purpose:** Inventory of all websites managed, including hosting and maintenance details.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Primary domain or site identifier |
| `🧑‍🚀 Client` | Relation → Clients | Site owner |
| `Hosted By` | Select | Indelible, Client |
| `Platform` | Select | WPMU Dev, Cloudways, Godaddy |
| `🤖 Hosting` | Relation → Hosting | Hosting plan |
| `🔧 Maintenance Plan` | Relation → Maintenance Plans | Service tier |
| `🔗 Domains` | Relation → Domains | Associated domains |
| `📇 Agency Partners` | Relation → Agency Partners | White-label partners |
| `📝 Notes` | Relation → Notes | Site-specific notes |
| `Notes` | Text | Quick notes field |

**Formulas:**
- `Hosting Details For Softr` - Formatted for partner portal
- `Maint Details for Softer` - Formatted for partner portal
- `Partner Portal Domain Filter` - Portal filtering logic

---

### 3. 🚧 Projects

**Purpose:** Track website projects from quote through completion with budget, timeline, and team management.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Project name |
| `Status` | Status | Quote, Queue, Ready, In progress, Review, Suspended, Done, Abandoned |
| `🧑‍🚀 Client` | Relation → Clients | Project client |
| `🕸️ Site` | Relation → Sites | Associated site(s) |
| `Start Date` | Date | Project start (can be range) |
| `Budget` | Number ($) | Project budget |
| `Day Rate` | Number ($) | Alternative billing structure |
| `Project Manager` | Person | Assigned PM |
| `Team` | Person (multi) | Project team members |
| `Figma File` | URL | Design file link |
| `Google Drive` | URL | Project folder link |
| `✅ Tasks` | Relation → Tasks | All project tasks |
| `🗣️ Meetings` | Relation → Meetings | Project meetings |
| `Research` | Relation → Research | Research items |

**Rollups:**
- `Energy Impact` - Sum of task energy estimates
- `Energy Variance` - Sum of task variance
- `Time Remaining Rollup` - Hours remaining
- `Time Spent Rollup` - Hours logged

**Formulas:**
- `Progress` - Completion percentage
- `Remaining` - Formatted time remaining
- `Time Estimate` - Formatted total estimate
- `Time Spent` - Formatted time spent

---

### 4. ✅ Tasks

**Purpose:** Central task management with sophisticated estimation, assignment, billing, and workflow tracking.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Task name |
| `Status` | Status | Planning, Inbox, Ready, In progress, Blocked, Review, Done, Abandoned |
| `🚧 Project` | Relation → Projects | Parent project (single) |
| `🕸️ Site` | Relation → Sites | Associated site (single) |
| `🧑‍🚀 Client` | Relation → Clients | Client (derived) |
| `Assigned To` | Person | Task assignee |
| `Phase` | Select | 1. ⚙️ Setup, 2. ✍️ Content & Strategy, 3. 🎨 Design, 4. 🧑‍💻 Build, 5. 🚀 Launch |
| `Type` | Select | Ticket, Project, Maintenance, Incident |
| `Priority` | Select | Low, Medium, High, Urgent |
| `Due Date` | Date | Task deadline |
| `Date Complete` | Date | Completion date |

**Energy & Estimation:**
| Property | Type | Description |
|----------|------|-------------|
| `Energy Impact` | Number | Base effort estimate (hours) |
| `Mystery Factor` | Select | None, Average, Significant, No Idea |
| `Battery Impact` | Select | Average Drain, High Drain, Energizing |
| `Billing Target` | Select | Low, Average, High |

**Billing:**
| Property | Type | Description |
|----------|------|-------------|
| `Billable` | Checkbox | Is task billable? |
| `Invoiced` | Checkbox | Has been invoiced? |
| `Approved` | Checkbox | Approved for work |
| `Approved Overage` | Checkbox | Overage approved |

**Workflow:**
| Property | Type | Description |
|----------|------|-------------|
| `Blocked by` | Relation → Tasks (self) | Blocking dependencies |
| `Blocking` | Relation → Tasks (self) | Tasks this blocks |
| `SOPs` | Relation → SOPs | Standard procedures |
| `💼 Functions` | Relation → Functions | Required job roles |
| `⏲️ Timeclock` | Relation → Timeclock | Time entries |

**Other:**
| Property | Type | Description |
|----------|------|-------------|
| `ID` | Auto-increment | Unique task ID |
| `Tags` | Multi-select | Design, Content, Development, Server Admin, Page Building, _Sales |
| `Notes` | Text | Task notes |
| `Focus` | Checkbox | Currently focused |
| `WMD` | Checkbox | Internal flag |
| `No Time Tracking` | Checkbox | Skip time tracking |

**Key Formulas:**
- `Ready?` - 🟢/🔴 indicator if task is ready to work
- `Range` - Formatted time range (e.g., "2 hrs — 3.5 hrs")
- `Weighted Energy` - Energy adjusted by mystery factor
- `Energy Variance` - Upper bound estimate
- `Billable Energy` - Billable hours calculation
- `Amount to Bill` - Dollar amount to bill
- `Time Remaining` - Formatted remaining time
- `Remaining Days` - Days until due
- `Week Of` - Week assignment for planning
- `Month Complete` - Month/year when completed
- `Burndown` - Burndown tracking
- `Rate for Timeclocks` - Rate to apply to time entries

**Rollups:**
- `Contracted Hours` - From client maintenance allocation
- `Hours Available?` - Available hours indicator
- `Rate` - Client hourly rate
- `Time Spent` - Total time logged
- `Project Figma` - Figma link from project
- `Project Google Drive` - Drive link from project

---

### 5. ⏲️ Timeclock

**Purpose:** Track time spent on tasks with clock-in/out or manual entry, with billing calculations.

| Property | Type | Description |
|----------|------|-------------|
| `Notes` | Title | Time entry description |
| `✅ Tasks` | Relation → Tasks | Associated task |
| `Person` | Person | Who logged the time |
| `Clock In Time` | Date/Time | Start time |
| `Clock Out Time` | Date/Time | End time |
| `Manual Time` | Number | Manually entered hours |
| `Entry Date` | Date | Date of entry |
| `Invoiced` | Checkbox | Included in invoice |
| `Not Billable` | Checkbox | Mark as non-billable |
| `End` | Button | Clock out action |

**Rollups:**
- `Client` - Client from task
- `Project` - Project from task
- `Max Billable` - Maximum billable from task
- `Rate` - Billing rate from task

**Formulas:**
- `Calculated Time` - Hours from clock in/out
- `Status` - Entry status indicator
- `To Bill` - Amount to bill
- `Client Filter` - For filtering views
- `Project Filter` - For filtering views

---

## Operational Databases

### 6. 📋 SOPs (Standard Operating Procedures)

**Purpose:** Document repeatable procedures that can be linked to tasks, ensuring consistent execution.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | SOP title |
| `Tags` | Multi-select | Content Strategy, Client Meetings, Wordpress, Hosting, Network Management, Design, Figma, Cornerstone, Forms |
| `Last Reviewed` | Date | Last review date |
| `💼 Functions` | Relation → Functions | Roles that use this SOP |
| `💼 Owner` | Relation → Functions | Role responsible for SOP |

**Formulas:**
- `Next Review` - Calculated next review date
- `Status` - 🟢/🔴 review status indicator

**How SOPs Work:**
1. SOPs are linked to Tasks via the `SOPs` relation
2. When a task is created, relevant SOPs provide step-by-step guidance
3. Tasks can display SOP content inline via rollups or by opening the linked SOP
4. SOPs are assigned to Functions, ensuring the right roles have access to relevant procedures

**Example SOPs:**
- Site Setup
- Page Build
- Mockup - Page
- Wordpress Site Migration (to WPMU Dev)
- Client Onboarding
- Kickoff Meeting
- Content Strategy
- Creating Forms

---

### 7. 💼 Functions

**Purpose:** Define job roles/functions that can be assigned to tasks and SOPs for clear responsibility.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Function/role name |
| `Primary Focus` | Text | Role description |

**Example Functions:**
- Project Manager
- Customer Success Manager
- Design II
- Wordpress Tech II
- Wordpress Tech III
- Network Admin
- Director of Operations

**How Functions Work:**
1. Functions define the skills/roles needed for tasks
2. Tasks link to Functions to indicate who should do the work
3. SOPs link to Functions to show which roles should follow them
4. This creates a skills-based assignment system separate from individual people

---

### 8. 🧑‍🍳 Recipes

**Purpose:** Document high-level project workflows and templates that orchestrate multiple phases, tasks, and SOPs.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Recipe name |

**How Recipes Work:**

Recipes are **workflow documentation pages** with minimal database properties. The actual recipe content lives in the page body and includes:

1. **Trigger Definition** - What initiates the recipe (e.g., "Signed proposal + deposit paid")
2. **Functions Overview** - Which roles are involved and their responsibilities
3. **Phase Breakdown** - Detailed steps organized by project phase
4. **Task Lists** - Specific tasks to create for each phase
5. **Decision Points** - Where approvals or reviews are needed
6. **Handoff Points** - When work transitions between roles

**Example Recipe Structure (Accelerated Site Recipe):**

```
🔔 Trigger: Signed proposal received + deposit paid

📋 Functions Overview:
- Project Manager (PM): Project orchestration, quality reviews, phase transitions
- Customer Success Advocate (CSA): Client communication, onboarding, scope management
- Designer: Mockups, brand implementation
- Developer: Site build, functionality

🎯 Phases:
1. ⚙️ Setup
   - Site provisioning
   - Figma setup
   - Client onboarding
   
2. ✍️ Content & Strategy
   - Kickoff meeting
   - Content strategy development
   - Content approval
   
3. 🎨 Design
   - Homepage mockup
   - Interior page mockups
   - Design approval
   
4. 🧑‍💻 Build
   - Page builds
   - Form setup
   - Functionality testing
   
5. 🚀 Launch
   - Client review
   - Final approval
   - DNS cutover
   - Post-launch checklist
```

**Recipes vs SOPs:**

| Aspect | Recipes 🧑‍🍳 | SOPs 📋 |
|--------|---------|------|
| Scope | Entire project workflow | Single procedure |
| Detail | High-level orchestration | Step-by-step instructions |
| Usage | Project planning template | Task execution guide |
| Links | References multiple SOPs | Linked to Tasks |
| Output | Creates multiple tasks | Guides one task |

---

## Supporting Databases

### 9. 🗣️ Meetings

**Purpose:** Track client and project meetings with recordings and transcripts.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Meeting title |
| `Date` | Date | Meeting date/time |
| `🚧 Projects` | Relation → Projects | Related project(s) |
| `🧑‍🚀 Clients` | Relation → Clients | Related client(s) |
| `Attendees (Indelible)` | Person | Internal attendees |
| `Meeting Link` | URL | Video call link |
| `Recording` | URL | Recording link |
| `Transcript` | File | Transcript file |

---

### 10. 🤖 Hosting

**Purpose:** Define hosting plans with pricing tiers for internal and white-label clients.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Plan name |
| `Rate` | Number ($) | Client rate |
| `Agency Rate` | Number ($) | White-label partner rate |
| `Monthly Cost` | Number ($) | Actual cost to Indelible |
| `Vendor Plan` | Text | Underlying vendor plan |
| `Details` | Text | Plan details |
| `Tags` | Multi-select | Secret Menu, CW, WPMU Dev |

**Formulas:**
- `Profit` - Direct client profit
- `Margin` - Direct margin percentage
- `WL Profit` - White-label profit
- `WL Margin` - White-label margin

---

### 11. 🔧 Maintenance Plans

**Purpose:** Define maintenance service tiers linked to sites.

*Schema details to be documented*

---

### 12. 🔗 Domains

**Purpose:** Track all domains associated with sites.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Domain name |
| `🕸️ Site` | Relation → Sites | Associated site |

---

### 13. 📝 Notes

**Purpose:** Site-specific notes and documentation.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Note title |
| `🕸️ Site` | Relation → Sites | Associated site |

---

### 14. 📇 Agency Partners

**Purpose:** Track white-label agency partnerships.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Partner name |

---

### 15. 👥 Team

**Purpose:** Team member directory.

*Schema details to be documented*

---

### 16. ↔️ Portal Affiliations

**Purpose:** Manage client portal access and connections.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Affiliation name |
| `Clients` | Relation → Clients | Affiliated clients |

---

### 17. 📨 Email Templates

**Purpose:** Store reusable email templates for client communication.

*Schema details to be documented*

---

### 18. 🧰 Tools

**Purpose:** Catalog of software tools and resources.

*Schema details to be documented*

---

### 19. Research

**Purpose:** Store research items linked to projects.

| Property | Type | Description |
|----------|------|-------------|
| `Name` | Title | Research item |
| `🚧 Projects` | Relation → Projects | Related project |

---

## Key Formulas Explained

### Energy System

The energy system provides sophisticated effort estimation:

```
Base: Energy Impact (hours)
  × Mystery Factor multiplier:
    - None: 1.0
    - Average: 1.3-1.5
    - Significant: 1.75
    - No Idea: 2.0+
  = Weighted Energy

Variance adds uncertainty buffer:
  Weighted Energy × variance factor = Energy Variance (upper bound)

Range displays: "X hrs — Y hrs"
```

### Billing Calculations

```
If Billable = true:
  Billable Energy = Weighted Energy (or based on Billing Target)
  Amount to Bill = Billable Energy × Rate
  
Rate comes from:
  Task → Project → Client → Hourly Rate
  OR
  Task → Site → Client → Hourly Rate
```

### Ready Status

```
Ready? = 🟢 if:
  - Status is not Done/Abandoned
  - All blocking tasks are complete
  - Required approvals obtained
  - Assigned To is set
  
Ready? = 🔴 otherwise
```

---

## Workflow Integration

### How It All Connects

1. **New Project Initiated**
   - Recipe provides workflow template
   - Project created with Client + Site links
   - Tasks generated based on Recipe phases

2. **Task Execution**
   - Task assigned to team member
   - Function indicates required skills
   - SOPs provide step-by-step guidance
   - Time tracked via Timeclock

3. **Progress Tracking**
   - Task Status updates flow to Project Progress
   - Energy calculations show remaining effort
   - Blocked/Blocking tracks dependencies

4. **Billing**
   - Billable tasks accumulate Amount to Bill
   - Timeclock entries validated against task estimates
   - Invoiced checkbox tracks billing status

5. **Completion**
   - Task marked Done with Date Complete
   - Project Progress reaches 100%
   - Recipe workflow completes

---

## Collection IDs Reference

| Database | Collection ID |
|----------|--------------|
| Tasks | `d5ce3847-f187-4d8c-aafb-d573a1f2693d` |
| Projects | `c1422091-7080-47b6-b8d2-ce7a3e149292` |
| Clients | `d21c0ea2-caf5-4f2e-9512-0bc10eed1e83` |
| Sites | `ebc7cb3c-40b9-4d01-91bd-aacc89914d9e` |
| Timeclock | `1f7e607a-d424-80c9-a531-000b59b2954f` |
| SOPs | `1e2e607a-d424-806d-9106-000b8b7104d2` |
| Functions | `1e8e607a-d424-809c-99b7-000b0ffae667` |
| Meetings | `1ffe607a-d424-80cc-94d9-000ba72feb28` |
| Recipes | `1d3e607a-d424-80a6-b139-000b19b0251e` |
| Hosting | `88f15bcc-c851-4b7b-9c6d-2ec2e3eabe9a` |
| Domains | `7ff9269a-86a2-4c5b-836d-bd83672932ac` |
| Maintenance Plans | `7e2e985b-a639-402e-91ae-b1c0f53a2c90` |
| Notes | `1bee607a-d424-807e-9468-000b4d7c5560` |
| Agency Partners | `1bee607a-d424-8082-87c4-000b55c9cd6f` |
| Portal Affiliations | `1e4e607a-d424-80ff-ba30-000b5882cca6` |
| Research | `29ce607a-d424-803d-91c6-000b06b302a6` |

---

## Status Options Summary

### Task Status (Status type with groups)
- **To Do:** Planning, Inbox, Ready
- **In Progress:** In progress, Blocked, Review
- **Complete:** Done, Abandoned

### Project Status (Status type with groups)
- **To Do:** Quote, Queue, Ready
- **In Progress:** In progress, Review, Suspended
- **Complete:** Done, Abandoned

### Client Status (Select)
- Active
- Inactive
- Never Again
- Delinquent

---

*Document generated from Notion schema analysis - December 2025*