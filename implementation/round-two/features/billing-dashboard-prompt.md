# TASK: Build Billing Dashboard Feature

## Overview

Create a Billing Dashboard screen for Admin and PM roles that consolidates all unbilled work across all clients. This is a new feature that replaces a manual Notion-based invoicing workflow.

## Step 1: Discovery & Evaluation

Before writing any code, analyze the current codebase and answer these questions:

### 1.1 Schema Evaluation
- Review the current `project_billing_milestones` table (if it exists) - what's the current structure?
- Review the `tasks` table - what billing-related fields exist (is_billable, invoiced, is_retainer_work)?
- Review the `time_entries` table - what fields exist for billable/invoiced status?
- Review the `projects` table - is there a billing_type field (retainer, milestone, hourly)?
- Review the `clients` table - what retainer-related fields exist (retainer_hours, etc.)?

### 1.2 Existing Code Evaluation
- What milestone-related code currently exists? (API routes, components, services)
- Is there any existing billing/invoicing code that should be integrated or removed?
- Are there any computed fields for energy_variance, amount_to_bill already implemented?

### 1.3 Document Findings
Create a brief summary of:
- Current state of billing-related schema
- Schema changes needed (if any)
- Existing code to integrate
- Existing code to remove (cleanup candidates)

---

## Step 2: Requirements

### 2.1 Billing Dashboard Location
- New route: `/app/(app)/billing` or similar
- Accessible to: Admin, PM roles only
- Add to sidebar navigation under appropriate section

### 2.2 Data to Display

The dashboard shows TWO types of unbilled items:

**A) Triggered Milestones**
- From projects with milestone-based billing
- Only milestones with status = 'triggered' (condition met, ready to invoice)
- Display: Milestone name, amount, project name, client, triggered date

**B) Completed Hourly Tasks**
- Tasks where status = 'done'
- NOT marked as invoiced
- NO active timer currently running against the task
- From projects with hourly billing OR ad-hoc tasks

### 2.3 Grouping & Hierarchy

Display grouped by client with white-label hierarchy:
```
▼ Agency Partner Name (white-label parent)
    ▼ End Client A
        [billable items for End Client A]
    ▼ End Client B  
        [billable items for End Client B]

▼ Direct Client Name (no parent)
    [billable items for Direct Client]
```

Within each client, show:
1. Milestones section (if any)
2. Hourly tasks section (if any)

### 2.4 Columns for Hourly Tasks

| Column | Description | Source |
|--------|-------------|--------|
| Task Name | Link to task detail | task.name |
| Calculated Time | Actual hours logged (display only) | SUM(time_entries.duration) for task |
| Max Billable | Energy variance - THE AMOUNT TO BILL | task.energy_variance |
| Project | Project name, link to project | task.project.name |
| Is Billable | Toggle - marking false removes row from dashboard | task.is_billable |
| Invoiced | Checkbox - marking true removes row from dashboard | task.invoiced |
| Date Completed | When task was marked done | task.date_complete |
| Rate | Client's hourly rate | client.hourly_rate |

### 2.5 Columns for Milestones

| Column | Description | Source |
|--------|-------------|--------|
| Milestone Name | Name of milestone | milestone.name |
| Amount | Dollar amount to bill | Calculated from milestone.amount + milestone.amount_type + project.budget |
| Project | Project name | project.name |
| Invoiced | Checkbox - marking true removes from dashboard | milestone.invoiced (or status → 'invoiced') |
| Triggered Date | When milestone was triggered | milestone.triggered_at |

### 2.6 Retainer Logic

For clients WITH retainer hours (`client.retainer_hours > 0`):

1. Calculate total retainer usage this month (sum of time on retainer work)
2. Calculate overage: usage - retainer_hours
3. Display ALL hours for ad-hoc/retainer tasks
4. Visually indicate which portion is overage (e.g., highlight rows, show "X of Y hrs are overage")
5. Only the OVERAGE hours get a dollar amount calculated (covered hours = $0)

For clients WITHOUT retainer:
- All billable hours display normally with full amounts

### 2.7 Computed Amounts

**Hourly tasks:**
```
amount_to_bill = energy_variance × client.hourly_rate
```

**Milestones (percentage-based):**
```
amount_to_bill = (milestone.amount / 100) × project.budget_amount
```

**Milestones (fixed):**
```
amount_to_bill = milestone.amount
```

### 2.8 Row Actions

- **Toggle Is Billable OFF**: Updates task.is_billable = false, row disappears from dashboard
- **Toggle Invoiced ON**: Updates task.invoiced = true (or milestone status = 'invoiced'), row disappears from dashboard

### 2.9 Summary Display

Per client grouping, show:
- Total amount to bill (sum of all visible billable items)
- Count of items

---

## Step 3: Implementation

### 3.1 API Endpoints Needed
```
GET /api/billing/unbilled
- Returns all unbilled milestones and tasks
- Grouped by client with hierarchy
- Includes computed amounts
- Excludes tasks with active timers

PATCH /api/tasks/:id/billing
- Update is_billable and/or invoiced flags

PATCH /api/milestones/:id/invoiced
- Mark milestone as invoiced
```

### 3.2 Component Structure
```
/app/(app)/billing/page.tsx          - Main dashboard page
/components/billing/
  BillingDashboard.tsx               - Main container
  ClientBillingGroup.tsx             - Collapsible client section
  MilestonesBillingTable.tsx         - Milestones list
  TasksBillingTable.tsx              - Hourly tasks list
  RetainerIndicator.tsx              - Shows retainer usage/overage
  BillingTotals.tsx                  - Summary amounts
```

### 3.3 Filtering

- No date filter by default (show ALL unbilled items)
- Optional: Add date range filter later if needed

---

## Step 4: Cleanup

After completing the feature, identify and document:
- Any dead code related to billing that was replaced
- Any unused milestone-related code
- Components or API routes that are no longer needed

---

## Deliverables

1. Discovery document with schema/code findings
2. Any necessary schema migrations
3. API endpoints
4. UI components and page
5. Cleanup list of removed code

## Notes

- This is an MVP - QuickBooks integration comes later
- Keep the invoiced toggle simple (just a boolean flag)
- Focus on usability for weekly invoicing workflow
- Project billing_type (retainer, milestone, hourly) determines how project tasks appear