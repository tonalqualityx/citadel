# Indelible App: Data Model Refinement
## Phase 3.2 Technical Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** âœ… Complete

---

## Overview

This document provides the complete, refined data model for the Indelible application, translating the Notion schema and subsequent planning work into production-ready PostgreSQL definitions. It addresses:

1. Complete PostgreSQL table definitions (DDL)
2. Index strategy for performance
3. Relationship constraints and referential integrity
4. Computed field implementation decisions
5. Soft delete strategy
6. Audit logging implementation
7. Migration scripts structure
8. Seed data requirements

---

## Table of Contents

1. [Design Decisions](#design-decisions)
2. [Core Entity Tables](#core-entity-tables)
3. [Supporting Tables](#supporting-tables)
4. [System Tables](#system-tables)
5. [Index Strategy](#index-strategy)
6. [Computed Fields](#computed-fields)
7. [Soft Delete Strategy](#soft-delete-strategy)
8. [Audit Logging](#audit-logging)
9. [Deferred Entities](#deferred-entities)
10. [Migration Structure](#migration-structure)
11. [Seed Data](#seed-data)

---

## Design Decisions

### Naming Conventions

| Convention | Standard |
|------------|----------|
| Table names | `snake_case`, plural nouns |
| Column names | `snake_case` |
| Primary keys | `id` (UUID) |
| Foreign keys | `{entity}_id` |
| Timestamps | `created_at`, `updated_at`, `deleted_at` |
| Booleans | `is_*` or `has_*` prefix where clarity needed |

### Data Types

| Concept | PostgreSQL Type |
|---------|-----------------|
| Primary keys | `UUID DEFAULT gen_random_uuid()` |
| Money/currency | `DECIMAL(10,2)` |
| Hours/duration | `DECIMAL(6,2)` |
| Short text | `VARCHAR(255)` |
| Long text | `TEXT` |
| Status/enum | `VARCHAR(50)` with CHECK constraint |
| JSON data | `JSONB` |
| Arrays | Native PostgreSQL arrays |

### Timezone Handling

All timestamps stored as `TIMESTAMP WITH TIME ZONE` (UTC). Application layer handles timezone conversion for display.

---

## Core Entity Tables

### 1. users

```sql
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(255) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    name                VARCHAR(255) NOT NULL,
    avatar_url          VARCHAR(500),
    role                VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'pm', 'tech')),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    
    -- Contact info
    phone               VARCHAR(50),
    
    -- Timestamps
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role ON users(role) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_active ON users(is_active) WHERE deleted_at IS NULL;
```

### 2. clients

```sql
CREATE TABLE clients (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'active' 
                        CHECK (status IN ('active', 'inactive', 'never_again', 'delinquent')),
    client_type         VARCHAR(20) NOT NULL DEFAULT 'direct'
                        CHECK (client_type IN ('direct', 'agency_partner', 'sub_client')),
    
    -- Contact info
    contact_name        VARCHAR(255),
    contact_email       VARCHAR(255),
    contact_phone       VARCHAR(50),
    contact_notes       TEXT,                           -- Communication preferences
    
    -- Billing defaults
    hourly_rate         DECIMAL(10,2),                  -- Default rate for this client
    
    -- Retainer settings
    retainer_hours      DECIMAL(6,2) DEFAULT 0,         -- Monthly allocation
    retainer_rollover   BOOLEAN DEFAULT false,          -- Allow unused hours to roll over
    support_cap_hours   DECIMAL(6,2),                   -- Optional cap for support tickets
    
    -- Parent relationship (for sub-clients)
    parent_client_id    UUID REFERENCES clients(id),
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_clients_status ON clients(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_type ON clients(client_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_parent ON clients(parent_client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_name ON clients(name) WHERE deleted_at IS NULL;
```

### 3. sites

```sql
CREATE TABLE sites (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,          -- Primary domain or identifier
    
    -- Relationships
    client_id           UUID NOT NULL REFERENCES clients(id),
    
    -- Hosting details
    hosted_by           VARCHAR(20) NOT NULL DEFAULT 'indelible'
                        CHECK (hosted_by IN ('indelible', 'client', 'other')),
    platform            VARCHAR(50),                    -- WordPress, Shopify, etc.
    hosting_plan_id     UUID REFERENCES hosting_plans(id),
    maintenance_plan_id UUID REFERENCES maintenance_plans(id),
    
    -- White-label partner (if site is managed for an agency partner)
    -- Note: Many-to-many via site_agency_partners table if site has multiple partners
    
    -- Status
    is_active           BOOLEAN NOT NULL DEFAULT true,
    
    -- Notes
    notes               TEXT,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_sites_client ON sites(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sites_hosting_plan ON sites(hosting_plan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sites_maintenance_plan ON sites(maintenance_plan_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sites_active ON sites(is_active) WHERE deleted_at IS NULL;
```

### 4. domains

```sql
CREATE TABLE domains (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,          -- e.g., "example.com"
    
    -- Relationships
    site_id             UUID NOT NULL REFERENCES sites(id),
    
    -- Registration details
    registrar           VARCHAR(100),
    expiry_date         DATE,
    auto_renew          BOOLEAN DEFAULT true,
    is_primary          BOOLEAN DEFAULT false,          -- Primary domain for the site
    
    -- SSL
    ssl_provider        VARCHAR(100),
    ssl_expiry_date     DATE,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_domains_site ON domains(site_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_domains_expiry ON domains(expiry_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_domains_ssl_expiry ON domains(ssl_expiry_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_domains_primary ON domains(site_id) WHERE is_primary = true AND deleted_at IS NULL;
```

### 5. projects

```sql
CREATE TABLE projects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    
    -- Status workflow
    status              VARCHAR(20) NOT NULL DEFAULT 'quote'
                        CHECK (status IN ('quote', 'queue', 'ready', 'in_progress', 
                                          'review', 'suspended', 'done', 'abandoned')),
    
    -- Relationships
    client_id           UUID NOT NULL REFERENCES clients(id),
    site_id             UUID REFERENCES sites(id),      -- Optional: may be new site
    pm_id               UUID REFERENCES users(id),      -- Project Manager
    
    -- Timeline
    start_date          DATE,
    target_end_date     DATE,
    actual_end_date     DATE,
    
    -- Billing type (set during wizard)
    billing_type        VARCHAR(20) NOT NULL DEFAULT 'fixed'
                        CHECK (billing_type IN ('fixed', 'hourly', 'retainer', 'day_rate', 'none')),
    
    -- Budget fields (set after proposal accepted)
    budget_hours        DECIMAL(8,2),                   -- Total budgeted hours
    hourly_rate         DECIMAL(10,2),                  -- Rate for this project (overrides client rate)
    budget_amount       DECIMAL(10,2),                  -- Total budget in dollars
    day_rate            DECIMAL(10,2),                  -- If billing_type = 'day_rate'
    
    -- Budget lock (after proposal finalized)
    budget_locked       BOOLEAN NOT NULL DEFAULT false,
    budget_locked_at    TIMESTAMPTZ,
    budget_locked_by_id UUID REFERENCES users(id),
    
    -- External links
    figma_url           VARCHAR(500),
    drive_url           VARCHAR(500),
    staging_url         VARCHAR(500),
    
    -- Internal
    is_internal         BOOLEAN NOT NULL DEFAULT false, -- Internal project vs client work
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_projects_client ON projects(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_site ON projects(site_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_pm ON projects(pm_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_status ON projects(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_dates ON projects(start_date, target_end_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_billing ON projects(billing_type) WHERE deleted_at IS NULL;
```

### 6. project_pages (Sitemap)

```sql
CREATE TABLE project_pages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    name                VARCHAR(255) NOT NULL,          -- Page name/title
    page_type           VARCHAR(50) NOT NULL DEFAULT 'standard'
                        CHECK (page_type IN ('home', 'standard', 'blog_index', 'blog_post',
                                             'landing', 'form', 'utility')),
    
    -- Hierarchy
    parent_page_id      UUID REFERENCES project_pages(id),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    depth               INTEGER NOT NULL DEFAULT 0,     -- Nesting level
    
    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned', 'in_progress', 'complete')),
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_project_pages_project ON project_pages(project_id);
CREATE INDEX idx_project_pages_parent ON project_pages(parent_page_id);
CREATE INDEX idx_project_pages_sort ON project_pages(project_id, sort_order);
```

### 7. project_team_assignments

```sql
CREATE TABLE project_team_assignments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id),
    function_id         UUID NOT NULL REFERENCES functions(id),
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(project_id, function_id)  -- One user per function per project
);

-- Indexes
CREATE INDEX idx_team_assignments_project ON project_team_assignments(project_id);
CREATE INDEX idx_team_assignments_user ON project_team_assignments(user_id);
CREATE INDEX idx_team_assignments_function ON project_team_assignments(function_id);
```

### 8. project_billing_milestones

```sql
CREATE TABLE project_billing_milestones (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    name                VARCHAR(255) NOT NULL,          -- e.g., "50% at Design Approval"
    percentage          DECIMAL(5,2) NOT NULL,          -- 50.00 = 50%
    trigger_type        VARCHAR(20) NOT NULL
                        CHECK (trigger_type IN ('manual', 'phase', 'task')),
    trigger_phase       VARCHAR(50),                    -- If trigger_type = 'phase'
    trigger_task_id     UUID REFERENCES tasks(id),      -- If trigger_type = 'task'
    
    -- Status
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'triggered', 'invoiced', 'paid')),
    triggered_at        TIMESTAMPTZ,
    triggered_by_id     UUID REFERENCES users(id),
    
    -- Invoice tracking
    invoice_number      VARCHAR(100),
    invoiced_at         TIMESTAMPTZ,
    paid_at             TIMESTAMPTZ,
    
    -- Calculated amount (budget Ã— percentage)
    amount              DECIMAL(10,2),
    
    sort_order          INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_milestones_project ON project_billing_milestones(project_id);
CREATE INDEX idx_milestones_status ON project_billing_milestones(status);
```

### 9. tasks

```sql
CREATE TABLE tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_number         SERIAL,                         -- Human-readable ID (auto-increment)
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    
    -- Status workflow
    status              VARCHAR(20) NOT NULL DEFAULT 'inbox'
                        CHECK (status IN ('planning', 'inbox', 'ready', 'in_progress', 
                                          'blocked', 'review', 'done', 'abandoned')),
    
    -- Context hierarchy
    client_id           UUID REFERENCES clients(id),    -- Inherited or direct
    site_id             UUID REFERENCES sites(id),      -- For ad-hoc site tasks
    project_id          UUID REFERENCES projects(id),   -- For project tasks
    project_page_id     UUID REFERENCES project_pages(id), -- Which sitemap page
    
    -- Classification
    task_type           VARCHAR(20) NOT NULL DEFAULT 'project'
                        CHECK (task_type IN ('project', 'ticket', 'maintenance', 'incident', 'internal')),
    phase               VARCHAR(50)
                        CHECK (phase IN ('setup', 'content_strategy', 'design', 'build', 'launch')),
    priority            VARCHAR(20) NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    
    -- Assignment
    function_id         UUID REFERENCES functions(id),  -- Required skill/role
    assignee_id         UUID REFERENCES users(id),
    reviewer_id         UUID REFERENCES users(id),
    
    -- Energy estimation
    energy_base         DECIMAL(6,2),                   -- Base hours estimate
    mystery_factor      VARCHAR(20) DEFAULT 'none'
                        CHECK (mystery_factor IN ('none', 'average', 'significant', 'no_idea')),
    battery_impact      VARCHAR(20) DEFAULT 'average'
                        CHECK (battery_impact IN ('average', 'high_drain', 'energizing')),
    
    -- Dates
    due_date            DATE,
    completed_at        TIMESTAMPTZ,
    
    -- Billing
    is_billable         BOOLEAN NOT NULL DEFAULT true,
    is_retainer_work    BOOLEAN NOT NULL DEFAULT false, -- Counts against retainer
    billing_target      VARCHAR(20) DEFAULT 'average'
                        CHECK (billing_target IN ('low', 'average', 'high')),
    is_invoiced         BOOLEAN NOT NULL DEFAULT false,
    is_approved         BOOLEAN NOT NULL DEFAULT false, -- Work approved to begin
    overage_approved    BOOLEAN NOT NULL DEFAULT false,
    
    -- Workflow flags
    is_focus            BOOLEAN NOT NULL DEFAULT false, -- Currently focused
    no_review           BOOLEAN NOT NULL DEFAULT false, -- Skip review step
    no_time_tracking    BOOLEAN NOT NULL DEFAULT false, -- Skip time tracking
    blocked_reason      TEXT,                           -- If status = 'blocked'
    
    -- SOP reference
    sop_id              UUID REFERENCES sops(id),       -- Template this was created from
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_tasks_client ON tasks(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_site ON tasks(site_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_project ON tasks(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_reviewer ON tasks(reviewer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_status ON tasks(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_phase ON tasks(phase) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_due_date ON tasks(due_date) WHERE deleted_at IS NULL AND status NOT IN ('done', 'abandoned');
CREATE INDEX idx_tasks_focus ON tasks(assignee_id, is_focus) WHERE is_focus = true AND deleted_at IS NULL;
CREATE INDEX idx_tasks_retainer ON tasks(client_id, is_retainer_work, completed_at) 
    WHERE is_retainer_work = true AND deleted_at IS NULL;

-- Unique task number per workspace
CREATE UNIQUE INDEX idx_tasks_number ON tasks(task_number);
```

### 10. task_requirements (Checklist)

```sql
CREATE TABLE task_requirements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    text                VARCHAR(500) NOT NULL,
    is_completed        BOOLEAN NOT NULL DEFAULT false,
    completed_at        TIMESTAMPTZ,
    completed_by_id     UUID REFERENCES users(id),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_task_requirements_task ON task_requirements(task_id);
CREATE INDEX idx_task_requirements_sort ON task_requirements(task_id, sort_order);
```

### 11. task_blockers (Dependencies)

```sql
CREATE TABLE task_blockers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocked_by_task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,                    -- When blocking task completed
    
    UNIQUE(task_id, blocked_by_task_id),
    CHECK (task_id != blocked_by_task_id)               -- Can't block itself
);

-- Indexes
CREATE INDEX idx_task_blockers_task ON task_blockers(task_id);
CREATE INDEX idx_task_blockers_blocking ON task_blockers(blocked_by_task_id);
CREATE INDEX idx_task_blockers_unresolved ON task_blockers(task_id) WHERE resolved_at IS NULL;
```

### 12. time_entries

```sql
CREATE TABLE time_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID NOT NULL REFERENCES tasks(id),
    user_id             UUID NOT NULL REFERENCES users(id),
    
    -- Time tracking
    started_at          TIMESTAMPTZ NOT NULL,
    ended_at            TIMESTAMPTZ,                    -- NULL = timer running
    duration_minutes    INTEGER,                        -- Calculated or manual
    is_manual           BOOLEAN NOT NULL DEFAULT false, -- Manual entry vs timer
    
    -- Entry date (for grouping/reporting, extracted from started_at)
    entry_date          DATE NOT NULL,
    
    -- Notes
    notes               TEXT,
    
    -- Billing
    is_billable         BOOLEAN NOT NULL DEFAULT true,
    is_invoiced         BOOLEAN NOT NULL DEFAULT false,
    hourly_rate         DECIMAL(10,2),                  -- Snapshot at time of entry
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_time_entries_task ON time_entries(task_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_time_entries_user ON time_entries(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_time_entries_date ON time_entries(entry_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_time_entries_user_date ON time_entries(user_id, entry_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_time_entries_active ON time_entries(user_id) WHERE ended_at IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_time_entries_billable ON time_entries(task_id, is_billable, is_invoiced) WHERE deleted_at IS NULL;
```

### 13. sops

```sql
CREATE TABLE sops (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    instructions        TEXT,                           -- Rich text / markdown
    
    -- Classification
    tags                TEXT[],                         -- Array of tags
    
    -- Ownership
    owner_function_id   UUID REFERENCES functions(id),  -- Which role owns this SOP
    
    -- Review tracking
    last_reviewed_at    DATE,
    review_interval_days INTEGER DEFAULT 90,            -- How often to review
    
    -- Status
    is_active           BOOLEAN NOT NULL DEFAULT true,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_sops_function ON sops(owner_function_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_sops_active ON sops(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_sops_tags ON sops USING GIN(tags) WHERE deleted_at IS NULL;
CREATE INDEX idx_sops_review_due ON sops(last_reviewed_at, review_interval_days) 
    WHERE is_active = true AND deleted_at IS NULL;
```

### 14. sop_template_requirements

```sql
CREATE TABLE sop_template_requirements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sop_id              UUID NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
    
    text                VARCHAR(500) NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_sop_template_reqs_sop ON sop_template_requirements(sop_id);
CREATE INDEX idx_sop_template_reqs_sort ON sop_template_requirements(sop_id, sort_order);
```

### 15. sop_tools (SOP â†” Tool references)

```sql
CREATE TABLE sop_tools (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sop_id              UUID NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
    tool_id             UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(sop_id, tool_id)
);

-- Indexes
CREATE INDEX idx_sop_tools_sop ON sop_tools(sop_id);
CREATE INDEX idx_sop_tools_tool ON sop_tools(tool_id);
```

### 16. recipes

```sql
CREATE TABLE recipes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    
    -- Classification
    category            VARCHAR(50)
                        CHECK (category IN ('website', 'seo', 'maintenance', 'consulting', 'other')),
    
    -- Configuration
    requires_sitemap    BOOLEAN NOT NULL DEFAULT false, -- Needs page configuration?
    estimated_tasks     INTEGER,                        -- Approx task count for display
    
    -- Workflow definition
    phases              JSONB,                          -- Phase definitions with order/icons
    documentation       JSONB,                          -- Rich documentation content
    trigger_description TEXT,                           -- When to use this recipe
    
    -- Status
    is_active           BOOLEAN NOT NULL DEFAULT true,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_recipes_active ON recipes(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_recipes_category ON recipes(category) WHERE deleted_at IS NULL;
```

### 17. recipe_tasks (Task templates within recipe)

```sql
CREATE TABLE recipe_tasks (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id           UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    
    -- Task template data
    name                VARCHAR(255) NOT NULL,          -- Can include {{variables}}
    description         TEXT,
    phase               VARCHAR(50)
                        CHECK (phase IN ('setup', 'content_strategy', 'design', 'build', 'launch')),
    
    -- Task type determines generation behavior
    task_type           VARCHAR(20) NOT NULL DEFAULT 'one_off'
                        CHECK (task_type IN ('one_off', 'variable', 'milestone', 'recurring')),
    
    -- Assignment template
    function_id         UUID REFERENCES functions(id),
    sop_id              UUID REFERENCES sops(id),
    
    -- Energy defaults
    energy_base         DECIMAL(6,2),
    mystery_factor      VARCHAR(20) DEFAULT 'none',
    battery_impact      VARCHAR(20) DEFAULT 'average',
    
    -- Milestone/billing configuration
    is_milestone        BOOLEAN NOT NULL DEFAULT false, -- Approval/gate task?
    default_billing_percentage DECIMAL(5,2),            -- Default % of budget for billing
    
    -- Variable task configuration (for per-page tasks)
    variable_config     JSONB,                          -- { "type": "per_page", "filter": {...} }
    
    -- Recurring task configuration
    recurring_config    JSONB,                          -- { "interval": "weekly", ... }
    
    -- Dependencies (references other recipe_tasks by name pattern)
    depends_on          TEXT[],                         -- Names of tasks this depends on
    
    sort_order          INTEGER NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_recipe_tasks_recipe ON recipe_tasks(recipe_id);
CREATE INDEX idx_recipe_tasks_sort ON recipe_tasks(recipe_id, sort_order);
CREATE INDEX idx_recipe_tasks_phase ON recipe_tasks(recipe_id, phase);
CREATE INDEX idx_recipe_tasks_milestone ON recipe_tasks(recipe_id) WHERE is_milestone = true;
```

### 18. functions

```sql
CREATE TABLE functions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,          -- e.g., "Design Lead"
    description         TEXT,
    
    -- Classification
    department          VARCHAR(50),                    -- e.g., "Design", "Development"
    
    -- Status
    is_active           BOOLEAN NOT NULL DEFAULT true,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_functions_active ON functions(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_functions_dept ON functions(department) WHERE deleted_at IS NULL;
```

### 19. user_functions (User capabilities)

```sql
CREATE TABLE user_functions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    function_id         UUID NOT NULL REFERENCES functions(id) ON DELETE CASCADE,
    
    -- Proficiency (for future assignment optimization)
    is_primary          BOOLEAN NOT NULL DEFAULT false, -- Primary skill vs secondary
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, function_id)
);

-- Indexes
CREATE INDEX idx_user_functions_user ON user_functions(user_id);
CREATE INDEX idx_user_functions_function ON user_functions(function_id);
CREATE INDEX idx_user_functions_primary ON user_functions(function_id) WHERE is_primary = true;
```

---

## Supporting Tables

### 20. meetings

```sql
CREATE TABLE meetings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               VARCHAR(255) NOT NULL,
    
    -- Timing
    scheduled_at        TIMESTAMPTZ NOT NULL,
    duration_minutes    INTEGER,
    
    -- Relationships
    client_id           UUID REFERENCES clients(id),
    project_id          UUID REFERENCES projects(id),
    
    -- Attendees (internal)
    attendee_ids        UUID[],                         -- Array of user IDs
    
    -- Meeting links
    meeting_url         VARCHAR(500),                   -- Video call link
    recording_url       VARCHAR(500),                   -- Recording link
    transcript_url      VARCHAR(500),                   -- Transcript file link
    
    -- Notes
    notes               TEXT,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_meetings_client ON meetings(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_meetings_project ON meetings(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_meetings_scheduled ON meetings(scheduled_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_meetings_attendees ON meetings USING GIN(attendee_ids) WHERE deleted_at IS NULL;
```

### 21. agency_partners

```sql
CREATE TABLE agency_partners (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    
    -- Contact info
    contact_name        VARCHAR(255),
    contact_email       VARCHAR(255),
    contact_phone       VARCHAR(50),
    
    -- Billing
    default_discount_percent DECIMAL(5,2),              -- Default discount for this partner
    
    -- Status
    is_active           BOOLEAN NOT NULL DEFAULT true,
    
    -- Notes
    notes               TEXT,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_agency_partners_active ON agency_partners(is_active) WHERE deleted_at IS NULL;
```

### 22. site_agency_partners (Junction table)

```sql
CREATE TABLE site_agency_partners (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    agency_partner_id   UUID NOT NULL REFERENCES agency_partners(id) ON DELETE CASCADE,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(site_id, agency_partner_id)
);

-- Indexes
CREATE INDEX idx_site_agency_partners_site ON site_agency_partners(site_id);
CREATE INDEX idx_site_agency_partners_partner ON site_agency_partners(agency_partner_id);
```

### 23. hosting_plans

```sql
CREATE TABLE hosting_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    
    -- Pricing tiers
    client_rate         DECIMAL(10,2) NOT NULL,         -- Direct client price
    agency_rate         DECIMAL(10,2),                  -- White-label partner price
    monthly_cost        DECIMAL(10,2),                  -- Actual cost to Indelible
    
    -- Vendor info
    vendor_name         VARCHAR(100),
    vendor_plan         VARCHAR(100),
    
    -- Classification
    tags                TEXT[],                         -- e.g., ['secret_menu', 'wpmu_dev']
    
    -- Status
    is_active           BOOLEAN NOT NULL DEFAULT true,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_hosting_plans_active ON hosting_plans(is_active) WHERE deleted_at IS NULL;
```

### 24. maintenance_plans

```sql
CREATE TABLE maintenance_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    
    -- Pricing
    client_rate         DECIMAL(10,2) NOT NULL,         -- Direct client price
    agency_rate         DECIMAL(10,2),                  -- White-label partner price
    
    -- Included hours
    hours_included      DECIMAL(6,2) NOT NULL DEFAULT 0,
    
    -- Features (stored as JSONB for flexibility)
    features            JSONB,                          -- { "backups": true, "updates": "weekly" }
    
    -- Status
    is_active           BOOLEAN NOT NULL DEFAULT true,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_maintenance_plans_active ON maintenance_plans(is_active) WHERE deleted_at IS NULL;
```

### 25. tools

```sql
CREATE TABLE tools (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    
    -- Access
    url                 VARCHAR(500),
    login_url           VARCHAR(500),
    
    -- Credentials (encrypted in application layer)
    credential_notes    TEXT,                           -- How to access credentials
    license_key         TEXT,                           -- Encrypted license key if applicable
    
    -- Classification
    category            VARCHAR(100),                   -- e.g., "Design", "Development", "Analytics"
    tags                TEXT[],
    
    -- Ownership
    owner_function_id   UUID REFERENCES functions(id),  -- Which role primarily uses this
    
    -- Status
    is_active           BOOLEAN NOT NULL DEFAULT true,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_tools_active ON tools(is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_tools_category ON tools(category) WHERE deleted_at IS NULL;
CREATE INDEX idx_tools_function ON tools(owner_function_id) WHERE deleted_at IS NULL;
```

### 26. notes

```sql
CREATE TABLE notes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               VARCHAR(255) NOT NULL,
    content             TEXT,                           -- Rich text / markdown
    
    -- Polymorphic relationship (one of these will be set)
    client_id           UUID REFERENCES clients(id) ON DELETE CASCADE,
    site_id             UUID REFERENCES sites(id) ON DELETE CASCADE,
    project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
    
    -- Author
    created_by_id       UUID REFERENCES users(id),
    
    -- Pinning
    is_pinned           BOOLEAN NOT NULL DEFAULT false,
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    
    -- Ensure exactly one parent
    CHECK (
        (client_id IS NOT NULL)::int + 
        (site_id IS NOT NULL)::int + 
        (project_id IS NOT NULL)::int = 1
    )
);

-- Indexes
CREATE INDEX idx_notes_client ON notes(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_site ON notes(site_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_project ON notes(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_pinned ON notes(is_pinned) WHERE is_pinned = true AND deleted_at IS NULL;
```

### 27. comments (Task comments)

```sql
CREATE TABLE comments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    content             TEXT NOT NULL,                  -- Rich text / markdown
    
    -- Author
    author_id           UUID NOT NULL REFERENCES users(id),
    
    -- Mentions (parsed from content, stored for quick lookup)
    mentioned_user_ids  UUID[],
    
    -- Thread support (optional)
    parent_comment_id   UUID REFERENCES comments(id),
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_comments_task ON comments(task_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_author ON comments(author_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_parent ON comments(parent_comment_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_mentions ON comments USING GIN(mentioned_user_ids) WHERE deleted_at IS NULL;
```

---

## System Tables

### 28. notifications

```sql
CREATE TABLE notifications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Type and data
    notification_type   VARCHAR(50) NOT NULL,           -- See types below
    data                JSONB NOT NULL,                 -- Notification-specific data
    
    -- Related entity (for navigation)
    entity_type         VARCHAR(50),                    -- 'task', 'project', etc.
    entity_id           UUID,
    
    -- Status
    is_read             BOOLEAN NOT NULL DEFAULT false,
    read_at             TIMESTAMPTZ,
    
    -- Bundling (for digest notifications)
    bundle_key          VARCHAR(255),                   -- Group similar notifications
    bundle_count        INTEGER DEFAULT 1,              -- How many in this bundle
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Notification types:
-- 'task_assigned', 'task_ready', 'task_commented', 'task_mentioned',
-- 'task_returned', 'task_review_ready', 'task_unblocked',
-- 'retainer_warning', 'retainer_exceeded', 'support_cap_hit',
-- 'milestone_triggered', 'project_status_changed'

-- Indexes
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE is_read = false;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_bundle ON notifications(user_id, bundle_key) WHERE bundle_key IS NOT NULL;
```

### 29. user_preferences

```sql
CREATE TABLE user_preferences (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    
    -- Display preferences
    naming_convention   VARCHAR(20) NOT NULL DEFAULT 'awesome'
                        CHECK (naming_convention IN ('awesome', 'standard')),
    theme               VARCHAR(20) NOT NULL DEFAULT 'system'
                        CHECK (theme IN ('system', 'light', 'dark')),
    sidebar_collapsed   BOOLEAN NOT NULL DEFAULT false,
    
    -- Notification preferences
    notification_bundle BOOLEAN NOT NULL DEFAULT true,
    notification_prefs  JSONB DEFAULT '{}'::jsonb,      -- Per-type email/in-app toggles
    
    -- Dashboard preferences
    dashboard_layout    JSONB,                          -- Custom dashboard arrangement
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX idx_user_preferences_user ON user_preferences(user_id);
```

### 30. activity_logs (Audit trail)

```sql
CREATE TABLE activity_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Actor
    user_id             UUID REFERENCES users(id),      -- NULL for system actions
    
    -- Action
    action              VARCHAR(50) NOT NULL,           -- 'created', 'updated', 'deleted', etc.
    
    -- Target entity
    entity_type         VARCHAR(50) NOT NULL,           -- 'task', 'project', etc.
    entity_id           UUID NOT NULL,
    
    -- Change details
    changes             JSONB,                          -- { field: { old: x, new: y } }
    metadata            JSONB,                          -- Additional context
    
    -- Client info
    ip_address          INET,
    user_agent          TEXT,
    
    -- Timestamp
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes (optimized for time-series queries)
CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at DESC);
CREATE INDEX idx_activity_logs_entity_created ON activity_logs(entity_type, entity_id, created_at DESC);

-- Partition by month for large datasets (optional)
-- CREATE TABLE activity_logs_2024_01 PARTITION OF activity_logs
--     FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

### 31. recent_items (User view history)

```sql
CREATE TABLE recent_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    entity_type         VARCHAR(50) NOT NULL,
    entity_id           UUID NOT NULL,
    
    -- Timestamp
    viewed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, entity_type, entity_id)
);

-- Indexes
CREATE INDEX idx_recent_items_user ON recent_items(user_id, viewed_at DESC);

-- Limit to 50 recent items per user (handled in application layer)
```

### 32. search_history

```sql
CREATE TABLE search_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    query               VARCHAR(500) NOT NULL,
    
    -- Timestamp
    searched_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_search_history_user ON search_history(user_id, searched_at DESC);

-- Limit to 20 recent searches per user (handled in application layer)
```

---

## Computed Fields

### Implementation Strategy

| Field | Location | Rationale |
|-------|----------|-----------|
| `task.weighted_energy` | API | Simple calculation, varies by mystery_factor |
| `task.energy_variance` | API | Depends on weighted_energy |
| `task.time_spent` | API | SUM from time_entries, cached invalidated on time entry changes |
| `task.is_ready` | API | Complex: checks blockers, project status, assignment |
| `task.burndown_percent` | API | time_spent / weighted_energy |
| `task.amount_to_bill` | API | Complex rate inheritance |
| `project.progress_percent` | API | COUNT done tasks / COUNT total tasks |
| `project.health` | API | Algorithm based on timeline, budget, blockers |
| `project.time_logged` | API | SUM from task time entries |
| `client.retainer_used_this_month` | API | SUM time entries WHERE is_retainer_work |
| `client.retainer_remaining` | API | retainer_hours - retainer_used_this_month |
| `client.retainer_status` | API | 'on_track' / 'warning' / 'exceeded' |
| `time_entry.duration_minutes` | DB Trigger | Calculate from started_at/ended_at on save |

### Database Triggers for Computed Fields

```sql
-- Auto-calculate duration on time entry save
CREATE OR REPLACE FUNCTION calculate_time_entry_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ended_at IS NOT NULL AND NEW.is_manual = false THEN
        NEW.duration_minutes := EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) / 60;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_time_entry_duration
    BEFORE INSERT OR UPDATE ON time_entries
    FOR EACH ROW
    EXECUTE FUNCTION calculate_time_entry_duration();

-- Auto-set entry_date from started_at
CREATE OR REPLACE FUNCTION set_time_entry_date()
RETURNS TRIGGER AS $$
BEGIN
    NEW.entry_date := DATE(NEW.started_at AT TIME ZONE 'UTC');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_time_entry_date
    BEFORE INSERT OR UPDATE ON time_entries
    FOR EACH ROW
    EXECUTE FUNCTION set_time_entry_date();

-- Auto-set updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_sites_updated BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_time_entries_updated BEFORE UPDATE ON time_entries FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_sops_updated BEFORE UPDATE ON sops FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_recipes_updated BEFORE UPDATE ON recipes FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_functions_updated BEFORE UPDATE ON functions FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_notes_updated BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_comments_updated BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION update_timestamp();
```

---

## Soft Delete Strategy

### Implementation

All major entities use soft delete via `deleted_at` column:

```sql
-- Tables with soft delete:
-- users, clients, sites, domains, projects, tasks, time_entries,
-- sops, recipes, functions, hosting_plans, maintenance_plans,
-- tools, notes, comments, meetings, agency_partners

-- Standard pattern:
deleted_at TIMESTAMPTZ  -- NULL = active, timestamp = deleted
```

### Cascade Behavior

| Parent Deleted | Child Behavior |
|----------------|----------------|
| Client deleted | Sites, Projects, Meetings remain but orphaned |
| Site deleted | Domains remain but orphaned |
| Project deleted | Tasks, Meetings remain but orphaned; project_pages, team_assignments hard deleted |
| Task deleted | Time entries remain (historical data); requirements, blockers, comments hard deleted |
| User deleted | Reassign or archive related entities |
| Agency Partner deleted | site_agency_partners junction records hard deleted |

### Permanent Deletion

True deletion only for:
- `project_pages` (CASCADE from project)
- `project_team_assignments` (CASCADE from project)
- `task_requirements` (CASCADE from task)
- `task_blockers` (CASCADE from task/blocking task)
- `sop_template_requirements` (CASCADE from SOP)
- `sop_tools` (CASCADE from SOP or tool)
- `recipe_tasks` (CASCADE from recipe)
- `user_functions` (CASCADE from user)
- `site_agency_partners` (CASCADE from site or agency_partner)
- `notifications` (after 90 days or on user delete)
- `activity_logs` (retained per policy, partitioned)
- `recent_items` (CASCADE from user)
- `search_history` (CASCADE from user)

### Restoration

```sql
-- Restore a soft-deleted entity
UPDATE clients SET deleted_at = NULL, updated_at = NOW() WHERE id = $1;
```

---

## Audit Logging

### What Gets Logged

| Entity | Actions Logged |
|--------|----------------|
| Users | create, update, deactivate, reactivate, login, password_change |
| Clients | create, update, delete, status_change |
| Sites | create, update, delete |
| Projects | create, update, delete, status_change, team_change |
| Tasks | create, update, delete, status_change, assign, reassign |
| Time Entries | create, update, delete |
| SOPs | create, update, delete |
| Recipes | create, update, delete |
| Functions | create, update, delete |
| System | bulk_operations, imports, exports |

### Log Format

```json
{
    "user_id": "uuid",
    "action": "updated",
    "entity_type": "task",
    "entity_id": "uuid",
    "changes": {
        "status": { "old": "ready", "new": "in_progress" },
        "assignee_id": { "old": null, "new": "uuid" }
    },
    "metadata": {
        "request_id": "uuid",
        "source": "api"
    },
    "ip_address": "192.168.1.1",
    "created_at": "2024-12-21T10:30:00Z"
}
```

### Retention Policy

| Log Type | Retention |
|----------|-----------|
| Activity logs | 2 years |
| Notifications | 90 days (read), 30 days (unread) |
| Search history | 30 days |
| Recent items | 50 items per user |

---

## Index Strategy

### Index Types Used

| Type | Use Case |
|------|----------|
| B-tree | Default for most columns (equality, range) |
| GIN | Arrays (tags), JSONB fields |
| Partial | Filtered indexes for common queries |
| Unique | Enforce constraints |
| Composite | Multi-column queries |

### Key Performance Indexes

```sql
-- Most common query patterns indexed:

-- 1. User's active tasks by status
CREATE INDEX idx_tasks_user_active ON tasks(assignee_id, status) 
    WHERE deleted_at IS NULL AND status NOT IN ('done', 'abandoned');

-- 2. Project tasks by phase
CREATE INDEX idx_tasks_project_phase ON tasks(project_id, phase, sort_order) 
    WHERE deleted_at IS NULL;

-- 3. Time entries for billing period
CREATE INDEX idx_time_entries_billing ON time_entries(task_id, entry_date, is_billable, is_invoiced)
    WHERE deleted_at IS NULL;

-- 4. Retainer tracking
CREATE INDEX idx_time_entries_retainer ON time_entries(task_id, entry_date)
    WHERE is_billable = true AND deleted_at IS NULL;

-- 5. Overdue tasks
CREATE INDEX idx_tasks_overdue ON tasks(due_date, assignee_id)
    WHERE due_date IS NOT NULL AND status NOT IN ('done', 'abandoned') AND deleted_at IS NULL;

-- 6. Full-text search (if needed)
CREATE INDEX idx_tasks_search ON tasks USING GIN(to_tsvector('english', name || ' ' || COALESCE(description, '')))
    WHERE deleted_at IS NULL;

CREATE INDEX idx_sops_search ON sops USING GIN(to_tsvector('english', name || ' ' || COALESCE(description, '')))
    WHERE deleted_at IS NULL;
```

---

## Migration Structure

### Migration Naming Convention

```
YYYYMMDDHHMMSS_description.sql

Examples:
20241221120000_create_users_table.sql
20241221120100_create_clients_table.sql
20241221120200_create_sites_table.sql
...
```

### Migration Order

1. **Foundation tables** (no foreign keys)
   - `users`
   - `functions`
   - `hosting_plans`
   - `maintenance_plans`
   - `tools`
   - `agency_partners`

2. **Core entity tables** (simple FKs)
   - `clients`
   - `sites`
   - `site_agency_partners`
   - `domains`
   - `sops`
   - `sop_template_requirements`
   - `sop_tools`
   - `recipes`
   - `recipe_tasks`

3. **Project hierarchy**
   - `projects`
   - `project_pages`
   - `project_team_assignments`
   - `project_billing_milestones`
   - `meetings`

4. **Task system**
   - `tasks`
   - `task_requirements`
   - `task_blockers`
   - `time_entries`
   - `comments`
   - `notes`

5. **Junction & system tables**
   - `user_functions`
   - `notifications`
   - `user_preferences`
   - `activity_logs`
   - `recent_items`
   - `search_history`

6. **Indexes** (separate migration for each table group)

7. **Triggers and functions**

8. **Seed data**

---

## Seed Data

### Required Seed Data

#### 1. Default User (Admin)

```sql
INSERT INTO users (id, email, password_hash, name, role) VALUES
    ('00000000-0000-0000-0000-000000000001', 'admin@indelible.agency', '$hash', 'System Admin', 'admin');
```

#### 2. Default Functions

```sql
INSERT INTO functions (name, department, is_active) VALUES
    ('Project Manager', 'Management', true),
    ('Design Lead', 'Design', true),
    ('Senior Developer', 'Development', true),
    ('Junior Developer', 'Development', true),
    ('Content Strategist', 'Content', true),
    ('QA Specialist', 'Quality', true);
```

#### 3. Default Hosting Plans

```sql
INSERT INTO hosting_plans (name, client_rate, agency_rate, monthly_cost, vendor_name, is_active) VALUES
    ('Starter', 25.00, 20.00, 10.00, 'Cloudways', true),
    ('Standard', 50.00, 40.00, 25.00, 'Cloudways', true),
    ('Premium', 100.00, 80.00, 50.00, 'Cloudways', true);
```

#### 4. Default Maintenance Plans

```sql
INSERT INTO maintenance_plans (name, client_rate, agency_rate, hours_included, is_active) VALUES
    ('Basic', 99.00, 79.00, 1.00, true),
    ('Standard', 199.00, 159.00, 3.00, true),
    ('Premium', 399.00, 319.00, 6.00, true);
```

#### 5. Project Phases Enum Reference

```sql
-- These are CHECK constraints, but document for reference:
-- 'setup', 'content_strategy', 'design', 'build', 'launch'
```

### Development Seed Data

For development/testing environments, additional seed data includes:
- Sample clients (3-5)
- Sample sites per client
- Sample projects in various statuses
- Sample tasks across phases
- Sample time entries
- Sample SOPs and recipes

---

## Deferred Entities

The following entities from the original Notion schema are **deferred to future phases** and not included in the MVP data model:

| Entity | Original Purpose | Deferral Reason |
|--------|------------------|-----------------|
| `portal_affiliations` | Client portal access management | Client portal is post-MVP feature |
| `email_templates` | Reusable email templates | Email automation is post-MVP |
| `research` | Research items linked to projects | Low usage, can be handled with notes |

These can be added in future migrations when the corresponding features are implemented.

---

## Related Documents

- `notion-schema.md` — Original Notion database schema
- `indelible-schema-addendum.md` — Schema extensions from wireframing
- `indelible-api-endpoint-inventory.md` — API specification referencing this model
- `indelible-app-architecture.md` — Technical architecture overview