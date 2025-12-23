# Indelible App: Schema Addendum
## Clarifications & Extensions to Notion Schema

**Version:** 2.0  
**Date:** December 2024  
**Status:** âœ… Complete

---

## Overview

This document captures clarifications and extensions to the original Notion schema (`notion-schema.md`) and app architecture (`indelible-app-architecture.md`) specific to the Indelible web application. It addresses:

1. Requirements checklist feature on Tasks/Quests
2. SOP/Rune template behavior
3. Naming convention toggle feature
4. Database table naming standards
5. **[NEW]** Project pages (sitemap) for variable task generation
6. **[NEW]** Project team assignments (function â†’ user mapping)
7. **[NEW]** Billing milestones and triggers
8. **[NEW]** User function relationships
9. **[NEW]** Recipe and Recipe Task extensions

---

## 1. Requirements (Task Checklist)

### Addition to Task/Quest Entity

Tasks have a **Requirements** checklistâ€”a simple list of checkbox items that must be completed as part of the task.

| Property | Type | Description |
|----------|------|-------------|
| `requirements` | JSON Array | Array of requirement items |

**Requirement Item Structure:**

```json
{
  "id": "uuid",
  "text": "Design hero section",
  "completed": false,
  "completed_at": null,
  "completed_by": null,
  "sort_order": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Unique identifier |
| `text` | String | Requirement description |
| `completed` | Boolean | Whether item is checked |
| `completed_at` | Timestamp | When completed (null if incomplete) |
| `completed_by` | UUID (User) | Who completed it (null if incomplete) |
| `sort_order` | Integer | Display order |

### Behavior

- Requirements are simple checkboxes, not full tasks
- No assignee, due date, or energy estimate per requirement
- Users can add, edit, reorder, and delete requirements
- Progress summary: "X of Y complete"
- When a Task is created from an SOP/Rune, requirements auto-populate from the template

---

## 2. SOP/Rune Template Behavior

### Template Checklist on SOPs

SOPs (Runes) contain a **template checklist** that serves as the default requirements for tasks created from that SOP.

| Property | Type | Description |
|----------|------|-------------|
| `template_requirements` | JSON Array | Default requirements for tasks using this SOP |

**Template Requirement Structure:**

```json
{
  "id": "uuid",
  "text": "Set up Figma project file",
  "sort_order": 1
}
```

### Creation Flow

When a Task/Quest is created from an SOP/Rune:

1. User selects SOP/Rune during task creation (or via Recipe/Scroll wizard)
2. System copies `template_requirements` from SOP into Task's `requirements`
3. Each copied requirement gets a new UUID, `completed: false`
4. User can then modify, add, or remove requirements as needed

### Relationship Summary

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚     SOP / Rune      â”‚
â”‚  ðŸ“œ                 â”‚
â”‚                     â”‚
â”‚  template_requirements:
â”‚  â˜ Step 1           â”‚
â”‚  â˜ Step 2           â”‚
â”‚  â˜ Step 3           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
           â”‚ creates task from template
           â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚    Task / Quest     â”‚
â”‚  âš”ï¸                 â”‚
â”‚                     â”‚
â”‚  sop_id: [ref]      â”‚  â† links back to source SOP
â”‚  requirements:      â”‚  â† copied from template
â”‚  â˜ Step 1           â”‚
â”‚  â˜ Step 2           â”‚
â”‚  â˜ Step 3           â”‚
â”‚  â˜ Step 4 (added)   â”‚  â† user can add more
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 3. Naming Convention Toggle

### Feature Description

Users can toggle between "Awesome" (fantasy-themed) and "Standard" (conventional) naming throughout the application.

**Location:** Settings â†’ Preferences â†’ Naming Convention

### Toggle Options

| Setting | Label | Description |
|---------|-------|-------------|
| `awesome` | "Awesome" | Fantasy-themed terminology (default) |
| `standard` | "Standard" | Conventional project management terms |

### Terminology Mapping

| Standard Term | Awesome Term | Icon | Database Table |
|---------------|--------------|------|----------------|
| Client | Patron | ðŸ§‘â€ðŸš€ | `clients` |
| Site | Site | ðŸ° | `sites` |
| Project | Pact | ðŸ¤ | `projects` |
| Task | Quest | âš”ï¸ | `tasks` |
| SOP | Rune | ðŸ“œ | `sops` |
| Recipe/Template | Scroll | ðŸ§‘â€ðŸ³ | `recipes` |
| Domain | Domain | ðŸ”— | `domains` |
| Tool | Tool | ðŸ”§ | `tools` |
| Function | Function | ðŸ‘¤ | `functions` |
| Time Entry | Time Entry | â±ï¸ | `time_entries` |
| Team Member | Guild Member | ðŸ‘¥ | `users` |
| Meeting | Council | ðŸ—£ï¸ | `meetings` |
| Note | Note | ðŸ“ | `notes` |

### Implementation Notes

- Database tables always use standard/generic names (see section 4)
- UI labels are driven by user preference
- Icons remain consistent regardless of naming mode
- API endpoints use standard terminology
- URLs use standard terminology for shareability

### User Preference Storage

```json
{
  "user_id": "uuid",
  "preferences": {
    "naming_convention": "awesome" | "standard"
  }
}
```

### Display Logic Example

```javascript
// Pseudocode
const labels = {
  awesome: {
    client: "Patron",
    project: "Pact", 
    task: "Quest",
    sop: "Rune",
    // ...
  },
  standard: {
    client: "Client",
    project: "Project",
    task: "Task",
    sop: "SOP",
    // ...
  }
};

function getLabel(entity, userPreference) {
  return labels[userPreference][entity];
}
```

### Where Naming Appears

| Location | Uses Preference |
|----------|-----------------|
| Navigation sidebar | âœ… Yes |
| Page headers | âœ… Yes |
| Breadcrumbs | âœ… Yes |
| Form labels | âœ… Yes |
| Button text | âœ… Yes |
| Empty states | âœ… Yes |
| Toast messages | âœ… Yes |
| Dropdown options | âœ… Yes |
| URLs/routes | âŒ No (always standard) |
| API endpoints | âŒ No (always standard) |
| Database tables | âŒ No (always standard) |
| Exports/reports | âš™ï¸ Configurable |

---

## 4. Database Table Naming Standards

All database tables use standard, conventional names to avoid reserved word conflicts and ensure clarity for developers.

### Core Tables

| Entity | Table Name | Notes |
|--------|------------|-------|
| Client/Patron | `clients` | |
| Site | `sites` | |
| Project/Pact | `projects` | |
| Task/Quest | `tasks` | |
| SOP/Rune | `sops` | |
| Recipe/Scroll | `recipes` | |
| Domain | `domains` | |
| Tool | `tools` | |
| Function | `functions` | Avoid `function` (reserved in many languages) |
| Time Entry | `time_entries` | |
| User/Guild Member | `users` | |
| Meeting/Council | `meetings` | |
| Note | `notes` | |

### Supporting Tables

| Entity | Table Name | Notes |
|--------|------------|-------|
| Requirement Item | `task_requirements` | Child of tasks |
| Template Requirement | `sop_template_requirements` | Child of sops |
| Dependency | `task_dependencies` | Self-referential join table |
| Hosting Plan | `hosting_plans` | |
| Maintenance Plan | `maintenance_plans` | |
| Agency Partner | `agency_partners` | |

### Naming Conventions for Tables

- Use lowercase with underscores (snake_case)
- Use plural nouns for entity tables
- Use `{parent}_{child}` pattern for child tables
- Avoid reserved words: `function`, `order`, `group`, `user`, `status`, `type`
- If unavoidable, use descriptive prefix: `task_status`, `user_role`

---

## 5. Updated Entity Relationship

### Task/Quest with Requirements

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                          TASKS                                   â”‚
â”‚                          âš”ï¸                                     â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                    UUID PRIMARY KEY                         â”‚
â”‚  name                  VARCHAR(255)                             â”‚
â”‚  description           TEXT                                     â”‚
â”‚  status                VARCHAR(50)                              â”‚
â”‚  priority              VARCHAR(50)                              â”‚
â”‚  energy_base           DECIMAL                                  â”‚
â”‚  energy_mystery_factor VARCHAR(50)                              â”‚
â”‚  due_date              DATE                                     â”‚
â”‚  phase                 VARCHAR(50)                              â”‚
â”‚                                                                 â”‚
â”‚  project_id            UUID REFERENCES projects(id)             â”‚
â”‚  site_id               UUID REFERENCES sites(id)                â”‚
â”‚  sop_id                UUID REFERENCES sops(id) NULLABLE        â”‚  â† Source template
â”‚  function_id           UUID REFERENCES functions(id) NULLABLE   â”‚
â”‚  assignee_id           UUID REFERENCES users(id) NULLABLE       â”‚
â”‚                                                                 â”‚
â”‚  created_at            TIMESTAMP                                â”‚
â”‚  updated_at            TIMESTAMP                                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                â”‚
                                â”‚ 1:many
                                â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                     TASK_REQUIREMENTS                            â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                    UUID PRIMARY KEY                         â”‚
â”‚  task_id               UUID REFERENCES tasks(id) ON DELETE CASCADE
â”‚  text                  VARCHAR(500)                             â”‚
â”‚  completed             BOOLEAN DEFAULT false                    â”‚
â”‚  completed_at          TIMESTAMP NULLABLE                       â”‚
â”‚  completed_by          UUID REFERENCES users(id) NULLABLE       â”‚
â”‚  sort_order            INTEGER                                  â”‚
â”‚                                                                 â”‚
â”‚  created_at            TIMESTAMP                                â”‚
â”‚  updated_at            TIMESTAMP                                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### SOP/Rune with Template Requirements

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                           SOPS                                   â”‚
â”‚                           ðŸ“œ                                    â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                    UUID PRIMARY KEY                         â”‚
â”‚  name                  VARCHAR(255)                             â”‚
â”‚  description           TEXT                                     â”‚
â”‚  instructions          TEXT                                     â”‚  â† Rich text content
â”‚  tags                  VARCHAR[] ARRAY                          â”‚
â”‚  last_reviewed         DATE                                     â”‚
â”‚                                                                 â”‚
â”‚  owner_function_id     UUID REFERENCES functions(id) NULLABLE   â”‚
â”‚                                                                 â”‚
â”‚  created_at            TIMESTAMP                                â”‚
â”‚  updated_at            TIMESTAMP                                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                â”‚
                                â”‚ 1:many
                                â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  SOP_TEMPLATE_REQUIREMENTS                       â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                    UUID PRIMARY KEY                         â”‚
â”‚  sop_id                UUID REFERENCES sops(id) ON DELETE CASCADE
â”‚  text                  VARCHAR(500)                             â”‚
â”‚  sort_order            INTEGER                                  â”‚
â”‚                                                                 â”‚
â”‚  created_at            TIMESTAMP                                â”‚
â”‚  updated_at            TIMESTAMP                                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 6. User Preferences Schema

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                      USER_PREFERENCES                            â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                    UUID PRIMARY KEY                         â”‚
â”‚  user_id               UUID REFERENCES users(id) UNIQUE         â”‚
â”‚                                                                 â”‚
â”‚  naming_convention     VARCHAR(20) DEFAULT 'awesome'            â”‚
â”‚                        CHECK (naming_convention IN ('awesome', 'standard'))
â”‚                                                                 â”‚
â”‚  theme                 VARCHAR(20) DEFAULT 'system'             â”‚
â”‚  notification_bundle   BOOLEAN DEFAULT true                     â”‚
â”‚  ... (other preferences)                                        â”‚
â”‚                                                                 â”‚
â”‚  created_at            TIMESTAMP                                â”‚
â”‚  updated_at            TIMESTAMP                                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 7. Terminology Quick Reference

For documentation and communication:

| Context | Use This |
|---------|----------|
| Database/API docs | Standard terms (Client, Project, Task) |
| User-facing docs | Both terms: "Tasks (Quests)" |
| UI mockups | Awesome terms with standard in parentheses first time |
| Code comments | Standard terms |
| Variable names | Standard terms (`task`, `project`, `client`) |

---

## 8. Project Pages (Sitemap)

### Purpose

When creating a project from a Recipe, users define the website's pages (sitemap). This drives variable task generationâ€”for example, creating one "Build Page" task per page, or one "Mockup" task per page that needs a unique design.

### New Entity: `project_pages`

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                       PROJECT_PAGES                              â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                      UUID PRIMARY KEY                        â”‚
â”‚  project_id              UUID NOT NULL REFERENCES projects(id)   â”‚
â”‚  name                    VARCHAR(255) NOT NULL                   â”‚
â”‚  page_type               VARCHAR(50) NOT NULL                    â”‚
â”‚  parent_page_id          UUID REFERENCES project_pages(id)       â”‚
â”‚  needs_unique_mockup     BOOLEAN DEFAULT true                    â”‚
â”‚  mockup_template_page_id UUID REFERENCES project_pages(id)       â”‚
â”‚  sort_order              INTEGER NOT NULL                        â”‚
â”‚  created_at              TIMESTAMP NOT NULL                      â”‚
â”‚  updated_at              TIMESTAMP NOT NULL                      â”‚
â”‚                                                                  â”‚
â”‚  FOREIGN KEY (project_id) ON DELETE CASCADE                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Primary key |
| `project_id` | UUID | Yes | FK to projects |
| `name` | VARCHAR(255) | Yes | Page name (e.g., "Home", "About Us") |
| `page_type` | VARCHAR(50) | Yes | Type classification |
| `parent_page_id` | UUID | No | FK to project_pages (for nav hierarchy) |
| `needs_unique_mockup` | BOOLEAN | Yes | Whether this page gets its own mockup task |
| `mockup_template_page_id` | UUID | No | If not unique, which page's mockup to use |
| `sort_order` | INTEGER | Yes | Display order in sitemap |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

### Page Types

| Value | Description | Example |
|-------|-------------|---------|
| `home` | Homepage | Home |
| `about` | About page | About Us, Our Team |
| `service` | Service/offering page | Web Design, SEO Services |
| `contact` | Contact page | Contact Us |
| `blog` | Blog listing or post template | Blog, News |
| `landing` | Landing/campaign page | Free Consultation |
| `product` | Product page (e-commerce) | Product Detail |
| `custom` | Other/custom page type | Any other page |

### Mockup Template Relationship

When `needs_unique_mockup = false`, the `mockup_template_page_id` indicates which page's mockup design will be reused. This creates an implicit dependency:

```
Page: "SEO Services"
â”œâ”€â”€ needs_unique_mockup: false
â”œâ”€â”€ mockup_template_page_id: â†’ "Services" page
â””â”€â”€ Behavior: 
    - No mockup task created for "SEO Services"
    - Build task for "SEO Services" is blocked by "Services" mockup approval
```

### Variable Task Generation

When a Recipe contains variable tasks with `type: "per_page"`, the system generates tasks by iterating over `project_pages`:

```javascript
// Pseudocode
for (page of project.pages) {
  if (recipeTask.variable_config.filter.needs_mockup && !page.needs_unique_mockup) {
    continue; // Skip pages using template mockups
  }
  
  createTask({
    name: recipeTask.name_template
      .replace('{{page_name}}', page.name)
      .replace('{{page_type}}', page.page_type),
    project_id: project.id,
    // ... other fields from recipe task
  });
}
```

---

## 9. Project Team Assignments

### Purpose

When creating a project, users assign team members to functions (roles). This determines who gets assigned to tasks based on the task's function requirement.

### New Entity: `project_function_assignments`

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                 PROJECT_FUNCTION_ASSIGNMENTS                     â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                      UUID PRIMARY KEY                        â”‚
â”‚  project_id              UUID NOT NULL REFERENCES projects(id)   â”‚
â”‚  function_id             UUID NOT NULL REFERENCES functions(id)  â”‚
â”‚  user_id                 UUID REFERENCES users(id)               â”‚
â”‚  created_at              TIMESTAMP NOT NULL                      â”‚
â”‚  updated_at              TIMESTAMP NOT NULL                      â”‚
â”‚                                                                  â”‚
â”‚  UNIQUE (project_id, function_id)                                â”‚
â”‚  FOREIGN KEY (project_id) ON DELETE CASCADE                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Primary key |
| `project_id` | UUID | Yes | FK to projects |
| `function_id` | UUID | Yes | FK to functions |
| `user_id` | UUID | No | FK to users (NULL = unassigned) |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

### Behavior

1. **During project creation:** Wizard shows all functions required by the Recipe's tasks
2. **Assignment:** User selects team member for each function (or leaves unassigned)
3. **Task creation:** When tasks are generated, `assignee_id` is set by looking up the project's function assignment
4. **Later changes:** Changing project assignment doesn't retroactively update existing tasks (but could show warning)

### Example

```
Project: "Acme Corp - Website Redesign"
â”œâ”€â”€ Function: Project Manager    â†’ User: Sarah Jenkins
â”œâ”€â”€ Function: CSA                â†’ User: Emily Chen
â”œâ”€â”€ Function: Content Writer     â†’ User: Alex Rivera
â”œâ”€â”€ Function: Designer           â†’ User: (unassigned)
â”œâ”€â”€ Function: WordPress Tech     â†’ User: (unassigned)
â”œâ”€â”€ Function: Network Admin      â†’ User: Tom Wilson
â””â”€â”€ Function: AR                 â†’ User: Finance Team
```

When a task is created with `function_id = Designer`, it gets `assignee_id = NULL` (unassigned) because no Designer is assigned to this project.

---

## 10. Billing Milestones

### Purpose

Projects can have billing milestones that trigger invoices when certain tasks or phases are completed. This supports the common pattern of "25% on design approval, 50% on build approval, 25% on launch."

### New Entity: `project_billing_milestones`

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  PROJECT_BILLING_MILESTONES                      â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                      UUID PRIMARY KEY                        â”‚
â”‚  project_id              UUID NOT NULL REFERENCES projects(id)   â”‚
â”‚  name                    VARCHAR(255) NOT NULL                   â”‚
â”‚  trigger_type            VARCHAR(50) NOT NULL                    â”‚
â”‚  trigger_task_id         UUID REFERENCES tasks(id)               â”‚
â”‚  trigger_phase           VARCHAR(50)                             â”‚
â”‚  amount_type             VARCHAR(20) NOT NULL                    â”‚
â”‚  amount                  DECIMAL NOT NULL                        â”‚
â”‚  status                  VARCHAR(20) DEFAULT 'pending'           â”‚
â”‚  triggered_at            TIMESTAMP                               â”‚
â”‚  invoice_id              UUID                                    â”‚
â”‚  sort_order              INTEGER NOT NULL                        â”‚
â”‚  created_at              TIMESTAMP NOT NULL                      â”‚
â”‚  updated_at              TIMESTAMP NOT NULL                      â”‚
â”‚                                                                  â”‚
â”‚  FOREIGN KEY (project_id) ON DELETE CASCADE                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Primary key |
| `project_id` | UUID | Yes | FK to projects |
| `name` | VARCHAR(255) | Yes | Milestone name ("Design Approval", "Final") |
| `trigger_type` | VARCHAR(50) | Yes | What triggers this milestone |
| `trigger_task_id` | UUID | No | FK to tasks (if task-triggered) |
| `trigger_phase` | VARCHAR(50) | No | Phase name (if phase-triggered) |
| `amount_type` | VARCHAR(20) | Yes | `percentage` or `fixed` |
| `amount` | DECIMAL | Yes | Amount (25 for 25%, or 1500.00 for $1500) |
| `status` | VARCHAR(20) | Yes | Current status |
| `triggered_at` | TIMESTAMP | No | When milestone was triggered |
| `invoice_id` | UUID | No | FK to invoices (future) |
| `sort_order` | INTEGER | Yes | Display order |
| `created_at` | TIMESTAMP | Yes | |
| `updated_at` | TIMESTAMP | Yes | |

### Trigger Types

| Value | Description | Trigger Condition |
|-------|-------------|-------------------|
| `task_completion` | Specific task completes | `trigger_task_id` task status = Done |
| `phase_completion` | All tasks in phase complete | All tasks where phase = `trigger_phase` are Done |
| `manual` | Manually triggered | User clicks "Trigger Milestone" |
| `project_start` | Project begins | Project status changes to `in_progress` |

### Status Values

| Value | Description |
|-------|-------------|
| `pending` | Waiting for trigger condition |
| `triggered` | Condition met, ready for invoicing |
| `invoiced` | Invoice sent |
| `paid` | Payment received |
| `cancelled` | Milestone cancelled |

### Milestone Calculation

For percentage-based milestones:

```javascript
// Pseudocode
const invoiceAmount = (milestone.amount / 100) * project.budget_amount;
```

### Example Configuration

```
Project: "Acme Corp - Website Redesign"
Budget: $6,000

Milestones:
â”œâ”€â”€ "Deposit" - 25% ($1,500)
â”‚   â””â”€â”€ trigger_type: project_start
â”œâ”€â”€ "Design Approval" - 25% ($1,500)
â”‚   â””â”€â”€ trigger_type: task_completion
â”‚   â””â”€â”€ trigger_task_id: â†’ "Client approval on complete design" task
â”œâ”€â”€ "Build Approval" - 50% ($3,000)
â”‚   â””â”€â”€ trigger_type: task_completion
â”‚   â””â”€â”€ trigger_task_id: â†’ "Client approval on staging site" task
```

---

## 11. User Functions

### Purpose

Team members can have multiple functions (roles). This allows filtering when assigning people to project functionsâ€”only show users who have the Designer function when assigning the Designer role.

### New Entity: `user_functions`

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                        USER_FUNCTIONS                            â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                      UUID PRIMARY KEY                        â”‚
â”‚  user_id                 UUID NOT NULL REFERENCES users(id)      â”‚
â”‚  function_id             UUID NOT NULL REFERENCES functions(id)  â”‚
â”‚  is_primary              BOOLEAN DEFAULT false                   â”‚
â”‚  created_at              TIMESTAMP NOT NULL                      â”‚
â”‚                                                                  â”‚
â”‚  UNIQUE (user_id, function_id)                                   â”‚
â”‚  FOREIGN KEY (user_id) ON DELETE CASCADE                         â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Primary key |
| `user_id` | UUID | Yes | FK to users |
| `function_id` | UUID | Yes | FK to functions |
| `is_primary` | BOOLEAN | Yes | Is this their main role? |
| `created_at` | TIMESTAMP | Yes | |

### Example

```
User: Sarah Jenkins
â”œâ”€â”€ Function: Project Manager (primary)
â””â”€â”€ Function: CSA

User: Mike Hansen  
â”œâ”€â”€ Function: Designer (primary)
â””â”€â”€ Function: WordPress Tech

User: Alex Rivera
â””â”€â”€ Function: Content Writer (primary)
```

### Usage in Assignment Dropdown

When the Pact creation wizard shows the "Designer" function assignment dropdown:

```sql
SELECT u.* 
FROM users u
JOIN user_functions uf ON u.id = uf.user_id
WHERE uf.function_id = :designer_function_id
  AND u.status = 'active'
ORDER BY uf.is_primary DESC, u.name ASC;
```

---

## 12. Recipe Extensions

### Additions to `recipes` Table

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | VARCHAR(50) | No | Recipe category for filtering |
| `is_active` | BOOLEAN | Yes | Whether recipe is available for new projects |
| `requires_sitemap` | BOOLEAN | Yes | Does this recipe need page configuration? |
| `estimated_tasks` | INTEGER | No | Approximate task count (for display) |

### Category Values

| Value | Description |
|-------|-------------|
| `website` | Website build projects |
| `seo` | SEO optimization projects |
| `maintenance` | Ongoing maintenance |
| `consulting` | Strategy/consulting engagements |
| `other` | Other project types |

### Updated Recipe Schema

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                          RECIPES                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                      UUID PRIMARY KEY                        â”‚
â”‚  name                    VARCHAR(255) NOT NULL                   â”‚
â”‚  description             TEXT                                    â”‚
â”‚  category                VARCHAR(50)                     [NEW]   â”‚
â”‚  is_active               BOOLEAN DEFAULT true            [NEW]   â”‚
â”‚  requires_sitemap        BOOLEAN DEFAULT false           [NEW]   â”‚
â”‚  estimated_tasks         INTEGER                         [NEW]   â”‚
â”‚  phases                  JSON NOT NULL                           â”‚
â”‚  documentation           JSON                                    â”‚
â”‚  trigger_description     TEXT                                    â”‚
â”‚  created_at              TIMESTAMP NOT NULL                      â”‚
â”‚  updated_at              TIMESTAMP NOT NULL                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 13. Recipe Task Extensions

### Additions to `recipe_tasks` Table

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `function_id` | UUID | No | FK to functions (who performs this task) |
| `is_milestone` | BOOLEAN | No | Is this an approval/milestone task? |
| `default_billing_percentage` | DECIMAL | No | Default % of budget for billing milestone |

### Updated Recipe Task Schema

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                        RECIPE_TASKS                              â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  id                          UUID PRIMARY KEY                    â”‚
â”‚  recipe_id                   UUID NOT NULL REFERENCES recipes    â”‚
â”‚  sop_id                      UUID REFERENCES sops(id)            â”‚
â”‚  function_id                 UUID REFERENCES functions(id) [NEW] â”‚
â”‚  name                        VARCHAR(255) NOT NULL               â”‚
â”‚  phase                       VARCHAR(50) NOT NULL                â”‚
â”‚  order                       INTEGER NOT NULL                    â”‚
â”‚  task_type                   VARCHAR(20) NOT NULL                â”‚
â”‚  is_milestone                BOOLEAN DEFAULT false        [NEW]  â”‚
â”‚  default_billing_percentage  DECIMAL                      [NEW]  â”‚
â”‚  variable_config             JSON                                â”‚
â”‚  recurring_config            JSON                                â”‚
â”‚  dependencies                VARCHAR[] ARRAY                     â”‚
â”‚  created_at                  TIMESTAMP NOT NULL                  â”‚
â”‚  updated_at                  TIMESTAMP NOT NULL                  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Task Type Values (Clarification)

| Value | Description | Generation |
|-------|-------------|------------|
| `one_off` | Single task, created once | 1 task |
| `variable` | Per-page or per-item task | N tasks based on sitemap/config |
| `milestone` | Approval/gate task | 1 task, may trigger billing |
| `recurring` | Repeating task | Generated on schedule |

### Function Resolution Order

When creating a task from a recipe task, the function is determined by:

1. `recipe_task.function_id` (explicit assignment)
2. `sop.function_id` (inherited from linked SOP)
3. NULL (unassigned, must be set manually)

---

## 14. Project Billing Fields

### Additions to `projects` Table

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `billing_type` | VARCHAR(20) | No | Type of billing arrangement |
| `budget_hours` | DECIMAL | No | Total budgeted hours |
| `hourly_rate` | DECIMAL | No | Rate for this project |
| `budget_amount` | DECIMAL | No | Total budget in dollars |

### Billing Type Values

| Value | Description | Budget Fields Used |
|-------|-------------|-------------------|
| `fixed` | Fixed price project | `budget_hours`, `hourly_rate`, `budget_amount` |
| `hourly` | Bill for actual hours | `hourly_rate` (no cap) |
| `retainer` | Monthly retainer | Uses client's `retainer_hours` |
| `none` | Internal/non-billable | None |

### Updated Project Schema (Partial)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                          PROJECTS                                â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  ...existing fields...                                           â”‚
â”‚                                                                  â”‚
â”‚  billing_type              VARCHAR(20)                   [NEW]   â”‚
â”‚  budget_hours              DECIMAL                       [NEW]   â”‚
â”‚  hourly_rate               DECIMAL                       [NEW]   â”‚
â”‚  budget_amount             DECIMAL                       [NEW]   â”‚
â”‚                                                                  â”‚
â”‚  ...existing fields...                                           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Budget Calculation

For fixed-price projects:

```javascript
budget_amount = budget_hours * hourly_rate;
```

The `hourly_rate` defaults from `client.hourly_rate` but can be overridden per project.

---

## 15. Complete New Tables Summary

### New Tables

| Table | Purpose |
|-------|---------|
| `project_pages` | Store sitemap for variable task generation |
| `project_function_assignments` | Map functions to team members per project |
| `project_billing_milestones` | Configure billing triggers tied to tasks |
| `user_functions` | Map users to their capable functions |

### Modified Tables

| Table | New Fields |
|-------|------------|
| `recipes` | `category`, `is_active`, `requires_sitemap`, `estimated_tasks` |
| `recipe_tasks` | `function_id`, `is_milestone`, `default_billing_percentage` |
| `projects` | `billing_type`, `budget_hours`, `hourly_rate`, `budget_amount` |

---

## 16. Entity Relationship Diagram (Updated)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    PACT CREATION WORKFLOW ENTITIES                               â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

                              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                              â”‚   RECIPES    â”‚
                              â”‚     ðŸ“œ       â”‚
                              â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                     â”‚ has many
                                     â–¼
                              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                              â”‚ RECIPE_TASKS â”‚
                              â”‚              â”‚
                              â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                     â”‚
         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
         â”‚                           â”‚                           â”‚
         â”‚ references                â”‚ references                â”‚
         â–¼                           â–¼                           â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”             â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”             â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚     SOPs     â”‚             â”‚  FUNCTIONS   â”‚             â”‚  (variable   â”‚
â”‚     ðŸ“œ       â”‚             â”‚     ðŸ‘¤       â”‚             â”‚   config)    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜             â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜             â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                    â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚                               â”‚
                    â–¼                               â–¼
           â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”           â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
           â”‚  USER_FUNCTIONS  â”‚           â”‚     PROJECT      â”‚
           â”‚                  â”‚           â”‚ FUNCTION_ASSIGN  â”‚
           â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜           â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                    â”‚                               â”‚
                    â–¼                               â”‚
             â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                       â”‚
             â”‚    USERS     â”‚â—„â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
             â”‚     ðŸ‘¥       â”‚
             â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜


                              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                              â”‚   PROJECTS   â”‚
                              â”‚     ðŸ¤       â”‚
                              â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                     â”‚
         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
         â”‚                           â”‚                           â”‚
         â–¼                           â–¼                           â–¼
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  PROJECT_PAGES   â”‚         â”‚ PROJECT_BILLING  â”‚         â”‚    TASKS     â”‚
â”‚     (sitemap)    â”‚         â”‚   _MILESTONES    â”‚         â”‚     âš”ï¸       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
         â”‚                           â”‚
         â”‚ drives generation         â”‚ triggers
         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º (invoices - future)
```

---

## Related Documents

- `notion-schema.md` â€” Original Notion database schema
- `indelible-app-architecture.md` â€” Technical architecture
- `indelible-component-library.md` â€” UI components
- `indelible-wireframes-quest-detail.md` â€” Quest/Task detail view
- `indelible-wireframes-list-views.md` â€” List view wireframes

---