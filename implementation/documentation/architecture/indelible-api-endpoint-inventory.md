# Indelible App: API Endpoint Inventory
## Phase 3.1 Technical Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** âœ… Complete

---

## Overview

This document catalogs all API endpoints required for the Indelible application. Each endpoint includes HTTP method, path, purpose, request/response shapes, authorization requirements, and related screens.

### API Conventions

| Convention | Value |
|------------|-------|
| Base URL | `/api/v1` |
| Auth | Bearer token (JWT) |
| Content-Type | `application/json` |
| Timestamps | ISO 8601 format |
| UUIDs | Standard v4 format |
| Pagination | Cursor-based with `limit`, `cursor`, `has_more` |
| Errors | `{ error: { code, message, details? } }` |

### Standard Response Envelope

```json
{
  "data": { ... },
  "meta": {
    "cursor": "next_cursor_string",
    "has_more": true,
    "total_count": 150
  }
}
```

### Role Abbreviations

| Role | Description |
|------|-------------|
| **Tech** | Team member (limited access) |
| **PM** | Project Manager (moderate access) |
| **Admin** | Administrator (full access) |
| **All** | All authenticated users |

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Current User](#2-current-user)
3. [Clients (Patrons)](#3-clients-patrons)
4. [Sites](#4-sites)
5. [Domains](#5-domains)
6. [Projects (Pacts)](#6-projects-pacts)
7. [Tasks (Quests)](#7-tasks-quests)
8. [Time Entries (Timeclock)](#8-time-entries-timeclock)
9. [SOPs (Runes)](#9-sops-runes)
10. [Recipes (Rituals)](#10-recipes-rituals)
11. [Functions](#11-functions)
12. [Hosting Plans](#12-hosting-plans)
13. [Maintenance Plans](#13-maintenance-plans)
14. [Tools](#14-tools)
15. [Users & Team](#15-users--team)
16. [Notifications](#16-notifications)
17. [Comments](#17-comments)
18. [Notes](#18-notes)
19. [Activity Logs](#19-activity-logs)
20. [Search](#20-search)
21. [Reports](#21-reports)
22. [Dashboard](#22-dashboard)
23. [Preferences](#23-preferences)

---

## 1. Authentication

### POST `/auth/login`
**Purpose:** Authenticate user and create session.

| Attribute | Value |
|-----------|-------|
| Access | Public |
| Related Screens | Login page |

**Request:**
```json
{
  "email": "user@indelible.agency",
  "password": "securePassword123"
}
```

**Response (200):**
```json
{
  "data": {
    "token": "jwt_token_string",
    "expires_at": "2024-01-15T00:00:00Z",
    "user": {
      "id": "uuid",
      "email": "user@indelible.agency",
      "name": "Mike Hansen",
      "role": "admin",
      "avatar_url": "https://..."
    }
  }
}
```

**Error Codes:**
- `401` — Invalid credentials
- `423` — Account deactivated

---

### POST `/auth/logout`
**Purpose:** Invalidate current session.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Header user menu |

**Response (204):** No content

---

### POST `/auth/forgot-password`
**Purpose:** Request password reset email.

| Attribute | Value |
|-----------|-------|
| Access | Public |
| Related Screens | Forgot password page |

**Request:**
```json
{
  "email": "user@indelible.agency"
}
```

**Response (200):**
```json
{
  "data": {
    "message": "If an account exists, a reset email has been sent."
  }
}
```

---

### POST `/auth/reset-password`
**Purpose:** Reset password using token from email.

| Attribute | Value |
|-----------|-------|
| Access | Public |
| Related Screens | Reset password page |

**Request:**
```json
{
  "token": "reset_token_from_email",
  "password": "newSecurePassword123",
  "password_confirmation": "newSecurePassword123"
}
```

**Response (200):**
```json
{
  "data": {
    "message": "Password has been reset successfully."
  }
}
```

**Error Codes:**
- `400` — Token expired or invalid
- `422` — Password validation failed

---

### POST `/auth/refresh`
**Purpose:** Refresh authentication token.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Background refresh |

**Response (200):**
```json
{
  "data": {
    "token": "new_jwt_token_string",
    "expires_at": "2024-01-16T00:00:00Z"
  }
}
```

---

## 2. Current User

### GET `/me`
**Purpose:** Get current authenticated user's profile.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Header, Settings |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "email": "user@indelible.agency",
    "name": "Mike Hansen",
    "role": "admin",
    "avatar_url": "https://...",
    "phone": "555-123-4567",
    "timezone": "America/New_York",
    "start_date": "2020-01-15",
    "weekly_availability": 40,
    "functions": [
      {
        "id": "uuid",
        "name": "Project Manager",
        "is_primary": true
      }
    ],
    "preferences": {
      "naming_convention": "awesome",
      "theme": "system",
      "notification_bundle": true
    }
  }
}
```

---

### PATCH `/me`
**Purpose:** Update current user's profile.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | User Settings |

**Request:**
```json
{
  "name": "Mike Hansen",
  "phone": "555-123-4567",
  "timezone": "America/New_York",
  "avatar_url": "https://..."
}
```

**Response (200):** Updated user object

---

### PATCH `/me/password`
**Purpose:** Change current user's password.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | User Settings |

**Request:**
```json
{
  "current_password": "oldPassword",
  "new_password": "newSecurePassword123",
  "new_password_confirmation": "newSecurePassword123"
}
```

**Response (200):**
```json
{
  "data": {
    "message": "Password updated successfully."
  }
}
```

---

## 3. Clients (Patrons)

### GET `/clients`
**Purpose:** List all clients with optional filters.

| Attribute | Value |
|-----------|-------|
| Access | All (rates hidden from Tech) |
| Related Screens | Patron List |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by status: `active`, `inactive` |
| `type` | string | Filter by type: `direct`, `agency_partner`, `sub_client` |
| `parent_id` | uuid | Filter sub-clients by parent agency |
| `has_retainer` | boolean | Filter clients with retainer |
| `pm_id` | uuid | Filter by primary PM |
| `search` | string | Search name, contact |
| `sort` | string | `name`, `created_at`, `updated_at` |
| `order` | string | `asc`, `desc` |
| `limit` | int | Default 50, max 100 |
| `cursor` | string | Pagination cursor |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "business_name": "Acme Corp",
      "type": "direct",
      "parent_agency_id": null,
      "contact_person": "John Smith",
      "email": "john@acme.com",
      "phone": "555-000-1234",
      "status": "active",
      "hourly_rate": 150.00,
      "retainer_hours": 10,
      "icon": "🏢",
      "primary_pm_id": "uuid",
      "primary_pm": {
        "id": "uuid",
        "name": "Sarah Johnson"
      },
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "_counts": {
        "sites": 3,
        "active_projects": 2
      },
      "_computed": {
        "retainer_used_this_month": 7.5,
        "retainer_planned": 3.0
      }
    }
  ],
  "meta": {
    "cursor": "next_cursor",
    "has_more": true,
    "total_count": 45
  }
}
```

**Note:** `hourly_rate` omitted for Tech role.

---

### GET `/clients/:id`
**Purpose:** Get single client with full details.

| Attribute | Value |
|-----------|-------|
| Access | All (rates hidden from Tech) |
| Related Screens | Patron Detail |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "business_name": "Acme Corp",
    "type": "direct",
    "parent_agency_id": null,
    "parent_agency": null,
    "contact_person": "John Smith",
    "email": "john@acme.com",
    "phone": "555-000-1234",
    "status": "active",
    "hourly_rate": 150.00,
    "retainer_hours": 10,
    "icon": "🏢",
    "primary_pm_id": "uuid",
    "primary_pm": {
      "id": "uuid",
      "name": "Sarah Johnson",
      "avatar_url": "https://..."
    },
    "contract_link": "https://drive.google.com/...",
    "proposal_link": "https://proposify.com/...",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "_counts": {
      "sites": 3,
      "active_projects": 2,
      "total_projects": 8,
      "total_tasks": 156
    },
    "_computed": {
      "retainer_used_this_month": 7.5,
      "retainer_planned": 3.0,
      "retainer_remaining": 2.5,
      "retainer_status": "approaching"
    }
  }
}
```

---

### POST `/clients`
**Purpose:** Create new client.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Create Patron Modal |

**Request:**
```json
{
  "business_name": "Acme Corp",
  "type": "direct",
  "parent_agency_id": null,
  "contact_person": "John Smith",
  "email": "john@acme.com",
  "phone": "555-000-1234",
  "status": "active",
  "hourly_rate": 150.00,
  "retainer_hours": 10,
  "primary_pm_id": "uuid",
  "icon": "🏢",
  "contract_link": "https://...",
  "proposal_link": "https://..."
}
```

**Response (201):** Created client object

---

### PATCH `/clients/:id`
**Purpose:** Update client.

| Attribute | Value |
|-----------|-------|
| Access | PM (own clients), Admin |
| Related Screens | Edit Patron Modal |

**Request:** Partial client object (any fields to update)

**Response (200):** Updated client object

---

### DELETE `/clients/:id`
**Purpose:** Soft delete client (archive).

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Patron Detail (more menu) |

**Response (204):** No content

---

### GET `/clients/:id/sites`
**Purpose:** List sites for a specific client.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Patron Detail (Sites tab) |

**Response (200):** Array of site objects

---

### GET `/clients/:id/projects`
**Purpose:** List projects for a specific client.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Patron Detail (Pacts tab) |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by project status |
| `include_completed` | boolean | Include done projects |

**Response (200):** Array of project summary objects

---

### GET `/clients/:id/retainer-usage`
**Purpose:** Get detailed retainer usage for current month.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Patron Detail (sidebar), Retainer Report |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `month` | string | YYYY-MM format (default: current) |

**Response (200):**
```json
{
  "data": {
    "client_id": "uuid",
    "month": "2024-01",
    "retainer_hours": 10,
    "hours_used": 7.5,
    "hours_planned": 3.0,
    "hours_remaining": 2.5,
    "status": "approaching",
    "entries": [
      {
        "task_id": "uuid",
        "task_name": "Homepage updates",
        "hours": 2.5,
        "date": "2024-01-15"
      }
    ]
  }
}
```

---

### GET `/clients/:id/notes`
**Purpose:** Get all notes related to a client (rolled up from sites and projects).

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Patron Detail (Notes tab) |

**Response (200):** Array of notes with source context

---

## 4. Sites

### GET `/sites`
**Purpose:** List all sites with optional filters.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Site List |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `client_id` | uuid | Filter by client |
| `platform` | string | Filter by platform |
| `has_hosting` | boolean | Has hosting plan |
| `has_maintenance` | boolean | Has maintenance plan |
| `webmaster_id` | uuid | Filter by webmaster |
| `search` | string | Search name, domain |
| `sort` | string | `name`, `created_at` |
| `order` | string | `asc`, `desc` |
| `limit` | int | Default 50 |
| `cursor` | string | Pagination cursor |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Acme Main Website",
      "url": "https://acme.com",
      "client_id": "uuid",
      "client": {
        "id": "uuid",
        "business_name": "Acme Corp"
      },
      "platform": "wordpress",
      "hosted_by": "indelible",
      "hosting_plan_id": "uuid",
      "hosting_plan": {
        "id": "uuid",
        "name": "Standard"
      },
      "maintenance_plan_id": "uuid",
      "maintenance_plan": {
        "id": "uuid",
        "name": "Basic"
      },
      "webmaster_id": "uuid",
      "webmaster": {
        "id": "uuid",
        "name": "Mike Hansen"
      },
      "icon": "🌐",
      "created_at": "2024-01-01T00:00:00Z",
      "_counts": {
        "domains": 2,
        "active_projects": 1
      }
    }
  ],
  "meta": { ... }
}
```

---

### GET `/sites/:id`
**Purpose:** Get single site with full details.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Site Detail |

**Response (200):** Full site object with nested domains, hosting, maintenance

---

### POST `/sites`
**Purpose:** Create new site.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Create Site Modal |

**Request:**
```json
{
  "name": "Acme Main Website",
  "url": "https://acme.com",
  "client_id": "uuid",
  "platform": "wordpress",
  "hosted_by": "indelible",
  "hosting_plan_id": "uuid",
  "maintenance_plan_id": "uuid",
  "webmaster_id": "uuid",
  "icon": "🌐",
  "notes": "Main company website"
}
```

**Response (201):** Created site object

---

### PATCH `/sites/:id`
**Purpose:** Update site.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Edit Site Modal |

**Request:** Partial site object

**Response (200):** Updated site object

---

### DELETE `/sites/:id`
**Purpose:** Soft delete site.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Site Detail |

**Response (204):** No content

---

### GET `/sites/:id/domains`
**Purpose:** List domains for a site.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Site Detail (Domains tab) |

**Response (200):** Array of domain objects

---

### GET `/sites/:id/projects`
**Purpose:** List projects for a site.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Site Detail (Pacts tab) |

**Response (200):** Array of project summary objects

---

### GET `/sites/:id/tasks`
**Purpose:** List ad-hoc tasks for a site (not tied to a project).

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Site Detail (Quests tab) |

**Response (200):** Array of task objects

---

## 5. Domains

### GET `/domains`
**Purpose:** List all domains with optional filters.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Domain List |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `site_id` | uuid | Filter by site |
| `client_id` | uuid | Filter by client |
| `registrar` | string | Filter by registrar |
| `expiring_within` | int | Days until expiration |
| `search` | string | Search domain name |
| `sort` | string | `name`, `expires_at` |
| `order` | string | `asc`, `desc` |
| `limit` | int | Default 50 |
| `cursor` | string | Pagination cursor |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "acme.com",
      "site_id": "uuid",
      "site": {
        "id": "uuid",
        "name": "Acme Main Website"
      },
      "registrar": "namecheap",
      "registered_at": "2020-01-01",
      "expires_at": "2025-01-01",
      "auto_renew": true,
      "is_primary": true,
      "dns_provider": "cloudflare",
      "ssl_provider": "letsencrypt",
      "ssl_expires_at": "2024-06-15",
      "created_at": "2024-01-01T00:00:00Z",
      "_computed": {
        "days_until_expiry": 180,
        "expiry_status": "healthy"
      }
    }
  ],
  "meta": { ... }
}
```

---

### GET `/domains/:id`
**Purpose:** Get single domain with full details.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Domain Detail (Peek Drawer) |

**Response (200):** Full domain object

---

### POST `/domains`
**Purpose:** Create new domain.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Create Domain Modal |

**Request:**
```json
{
  "name": "acme.com",
  "site_id": "uuid",
  "registrar": "namecheap",
  "registered_at": "2020-01-01",
  "expires_at": "2025-01-01",
  "auto_renew": true,
  "is_primary": true,
  "dns_provider": "cloudflare",
  "ssl_provider": "letsencrypt",
  "ssl_expires_at": "2024-06-15"
}
```

**Response (201):** Created domain object

---

### PATCH `/domains/:id`
**Purpose:** Update domain.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Edit Domain Modal |

**Request:** Partial domain object

**Response (200):** Updated domain object

---

### DELETE `/domains/:id`
**Purpose:** Delete domain.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Domain Detail |

**Response (204):** No content

---

## 6. Projects (Pacts)

### GET `/projects`
**Purpose:** List all projects with optional filters.

| Attribute | Value |
|-----------|-------|
| Access | All (budget hidden from Tech) |
| Related Screens | Pact List |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `client_id` | uuid | Filter by client |
| `site_id` | uuid | Filter by site |
| `pm_id` | uuid | Filter by PM |
| `status` | string | `quote`, `queue`, `ready`, `in_progress`, `review`, `suspended`, `done`, `abandoned` |
| `is_retainer_work` | boolean | Filter retainer vs project work |
| `health` | string | `on_track`, `at_risk`, `behind` |
| `search` | string | Search name |
| `sort` | string | `name`, `created_at`, `target_end_date` |
| `order` | string | `asc`, `desc` |
| `limit` | int | Default 50 |
| `cursor` | string | Pagination cursor |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Website Redesign",
      "client_id": "uuid",
      "client": {
        "id": "uuid",
        "business_name": "Acme Corp"
      },
      "site_id": "uuid",
      "site": {
        "id": "uuid",
        "name": "Acme Main Website"
      },
      "recipe_id": "uuid",
      "pm_id": "uuid",
      "pm": {
        "id": "uuid",
        "name": "Sarah Johnson",
        "avatar_url": "https://..."
      },
      "status": "in_progress",
      "is_retainer_work": false,
      "billing_type": "fixed",
      "budget_amount": 15000.00,
      "start_date": "2024-01-01",
      "target_end_date": "2024-03-01",
      "phases": ["Setup", "Content", "Design", "Build", "Launch"],
      "current_phase": "Design",
      "icon": "🎨",
      "created_at": "2024-01-01T00:00:00Z",
      "_counts": {
        "total_tasks": 24,
        "completed_tasks": 12,
        "blocked_tasks": 1
      },
      "_computed": {
        "progress_percent": 50,
        "health": "on_track",
        "time_logged": 32.5,
        "time_estimated_low": 40,
        "time_estimated_high": 55
      }
    }
  ],
  "meta": { ... }
}
```

---

### GET `/projects/:id`
**Purpose:** Get single project with full details.

| Attribute | Value |
|-----------|-------|
| Access | All (budget hidden from Tech) |
| Related Screens | Pact Detail |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "name": "Website Redesign",
    "description": "Full redesign of the main website...",
    "client_id": "uuid",
    "client": { ... },
    "site_id": "uuid",
    "site": { ... },
    "recipe_id": "uuid",
    "recipe": {
      "id": "uuid",
      "name": "Standard Website Build"
    },
    "pm_id": "uuid",
    "pm": { ... },
    "status": "in_progress",
    "is_retainer_work": false,
    "billing_type": "fixed",
    "budget_amount": 15000.00,
    "budget_hours": null,
    "hourly_rate": 150.00,
    "start_date": "2024-01-01",
    "target_end_date": "2024-03-01",
    "phases": [...],
    "current_phase": "Design",
    "icon": "🎨",
    "figma_link": "https://figma.com/...",
    "drive_link": "https://drive.google.com/...",
    "staging_link": "https://staging.acme.com",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-15T00:00:00Z",
    "team_assignments": [
      {
        "function_id": "uuid",
        "function_name": "Designer",
        "user_id": "uuid",
        "user": {
          "id": "uuid",
          "name": "Jane Doe",
          "avatar_url": "https://..."
        }
      }
    ],
    "milestones": [
      {
        "id": "uuid",
        "name": "Design Approval",
        "amount": 5000.00,
        "trigger_type": "phase_complete",
        "trigger_config": { "phase": "Design" },
        "target_date": "2024-02-01",
        "status": "pending"
      }
    ],
    "pages": [
      {
        "id": "uuid",
        "name": "Homepage",
        "page_type": "homepage",
        "needs_mockup": true,
        "needs_content": true,
        "notes": "Hero section focus"
      }
    ],
    "_counts": {
      "total_tasks": 24,
      "completed_tasks": 12,
      "blocked_tasks": 1,
      "review_tasks": 2
    },
    "_computed": {
      "progress_percent": 50,
      "health": "on_track",
      "time_logged": 32.5,
      "time_estimated_low": 40,
      "time_estimated_high": 55,
      "phase_progress": [
        { "phase": "Setup", "complete": 4, "total": 4 },
        { "phase": "Content", "complete": 3, "total": 3 },
        { "phase": "Design", "complete": 2, "total": 5 },
        { "phase": "Build", "complete": 0, "total": 8 },
        { "phase": "Launch", "complete": 0, "total": 4 }
      ]
    }
  }
}
```

---

### POST `/projects`
**Purpose:** Create new project (simple creation, no wizard).

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Create Pact Modal (Simple) |

**Request:**
```json
{
  "name": "Website Redesign",
  "client_id": "uuid",
  "site_id": "uuid",
  "pm_id": "uuid",
  "status": "quote",
  "is_retainer_work": false,
  "billing_type": "fixed",
  "budget_amount": 15000.00,
  "start_date": "2024-01-01",
  "target_end_date": "2024-03-01",
  "icon": "🎨"
}
```

**Response (201):** Created project object

---

### POST `/projects/wizard`
**Purpose:** Create project via wizard (with task generation from recipe).

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Pact Creation Wizard |

**Request:**
```json
{
  "name": "Website Redesign",
  "client_id": "uuid",
  "site_id": "uuid",
  "recipe_id": "uuid",
  "pm_id": "uuid",
  "status": "quote",
  "is_retainer_work": false,
  "billing_type": "fixed",
  "budget_amount": 15000.00,
  "start_date": "2024-01-01",
  "target_end_date": "2024-03-01",
  "icon": "🎨",
  "pages": [
    {
      "name": "Homepage",
      "page_type": "homepage",
      "needs_mockup": true,
      "needs_content": true,
      "notes": "Hero section focus"
    },
    {
      "name": "About Us",
      "page_type": "interior",
      "needs_mockup": true,
      "needs_content": true,
      "notes": ""
    }
  ],
  "team_assignments": [
    {
      "function_id": "uuid",
      "user_id": "uuid"
    }
  ],
  "milestones": [
    {
      "name": "Design Approval",
      "amount": 5000.00,
      "trigger_type": "phase_complete",
      "trigger_config": { "phase": "Design" },
      "target_date": "2024-02-01"
    }
  ],
  "generate_tasks": true
}
```

**Response (201):**
```json
{
  "data": {
    "project": { ... },
    "tasks_created": 24,
    "milestones_created": 3
  }
}
```

---

### PATCH `/projects/:id`
**Purpose:** Update project.

| Attribute | Value |
|-----------|-------|
| Access | PM (own projects), Admin |
| Related Screens | Edit Pact Modal |

**Request:** Partial project object

**Response (200):** Updated project object

---

### PATCH `/projects/:id/status`
**Purpose:** Change project status (with side effects like notifications).

| Attribute | Value |
|-----------|-------|
| Access | PM (own projects), Admin |
| Related Screens | Pact Detail (status dropdown) |

**Request:**
```json
{
  "status": "in_progress"
}
```

**Response (200):** Updated project with notification summary

**Side Effects:**
- Quote → Ready/In Progress: Sends bundled notifications to assignees
- → Suspended: Tasks become invisible to assignees
- → Done: All tasks marked complete

---

### DELETE `/projects/:id`
**Purpose:** Soft delete project.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Pact Detail |

**Response (204):** No content

---

### GET `/projects/:id/tasks`
**Purpose:** List tasks for a project with filtering.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Pact Detail (Quests tab) |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter by status |
| `phase` | string | Filter by phase |
| `assignee_id` | uuid | Filter by assignee |
| `function_id` | uuid | Filter by function |
| `group_by` | string | `phase`, `status`, `assignee` |
| `sort` | string | `order`, `created_at`, `due_date` |

**Response (200):** Array of task objects

---

### PATCH `/projects/:id/tasks/reorder`
**Purpose:** Reorder tasks within a project (drag-drop).

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Pact Detail (Quests tab) |

**Request:**
```json
{
  "task_orders": [
    { "id": "uuid", "order": 1, "phase": "Design" },
    { "id": "uuid", "order": 2, "phase": "Design" },
    { "id": "uuid", "order": 3, "phase": "Design" }
  ]
}
```

**Response (200):** Success confirmation

---

### GET `/projects/:id/team`
**Purpose:** Get team assignments for a project.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Pact Detail (Overview), Manage Team Modal |

**Response (200):**
```json
{
  "data": [
    {
      "function_id": "uuid",
      "function": {
        "id": "uuid",
        "name": "Designer"
      },
      "user_id": "uuid",
      "user": {
        "id": "uuid",
        "name": "Jane Doe",
        "avatar_url": "https://..."
      }
    }
  ]
}
```

---

### PUT `/projects/:id/team`
**Purpose:** Replace all team assignments.

| Attribute | Value |
|-----------|-------|
| Access | PM (own projects), Admin |
| Related Screens | Manage Team Modal |

**Request:**
```json
{
  "assignments": [
    { "function_id": "uuid", "user_id": "uuid" },
    { "function_id": "uuid", "user_id": "uuid" }
  ]
}
```

**Response (200):** Updated assignments array

**Side Effects:**
- Updates assignee on tasks based on function mapping
- Does NOT notify if project not yet active

---

### GET `/projects/:id/milestones`
**Purpose:** Get billing milestones for a project.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Pact Detail (Overview), Manage Milestones Modal |

**Response (200):** Array of milestone objects

---

### PUT `/projects/:id/milestones`
**Purpose:** Replace all milestones.

| Attribute | Value |
|-----------|-------|
| Access | PM (own projects), Admin |
| Related Screens | Manage Milestones Modal |

**Request:**
```json
{
  "milestones": [
    {
      "name": "Design Approval",
      "amount": 5000.00,
      "trigger_type": "phase_complete",
      "trigger_config": { "phase": "Design" },
      "target_date": "2024-02-01"
    }
  ]
}
```

**Response (200):** Updated milestones array

---

### POST `/projects/:id/milestones/:milestoneId/trigger`
**Purpose:** Manually trigger a milestone (for manual trigger type).

| Attribute | Value |
|-----------|-------|
| Access | PM (own projects), Admin |
| Related Screens | Pact Detail (Milestones) |

**Response (200):** Updated milestone with triggered status

---

### GET `/projects/:id/pages`
**Purpose:** Get sitemap pages for a project.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Pact Detail, Wizard Step 4 |

**Response (200):** Array of page objects

---

### PUT `/projects/:id/pages`
**Purpose:** Replace all project pages.

| Attribute | Value |
|-----------|-------|
| Access | PM (own projects), Admin |
| Related Screens | Edit sitemap |

**Request:**
```json
{
  "pages": [
    {
      "name": "Homepage",
      "page_type": "homepage",
      "needs_mockup": true,
      "needs_content": true,
      "notes": "Focus on hero"
    }
  ]
}
```

**Response (200):** Updated pages array

---

### GET `/projects/:id/time-summary`
**Purpose:** Get time tracking summary for a project.

| Attribute | Value |
|-----------|-------|
| Access | PM (own projects), Admin |
| Related Screens | Pact Detail (Time & Budget tab) |

**Response (200):**
```json
{
  "data": {
    "total_logged": 32.5,
    "estimated_low": 40,
    "estimated_high": 55,
    "by_phase": [
      { "phase": "Setup", "logged": 4, "estimated_low": 3, "estimated_high": 5 },
      { "phase": "Design", "logged": 14.5, "estimated_low": 12, "estimated_high": 18 }
    ],
    "by_user": [
      { "user_id": "uuid", "name": "Jane Doe", "hours": 14.5 },
      { "user_id": "uuid", "name": "Mike Hansen", "hours": 18 }
    ]
  }
}
```

---

## 7. Tasks (Quests)

### GET `/tasks`
**Purpose:** List tasks with powerful filtering.

| Attribute | Value |
|-----------|-------|
| Access | All (billing hidden from Tech) |
| Related Screens | Quest List (Global) |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `project_id` | uuid | Filter by project |
| `client_id` | uuid | Filter by client |
| `site_id` | uuid | Filter by site |
| `assignee_id` | uuid | Filter by assignee |
| `reviewer_id` | uuid | Filter by reviewer |
| `function_id` | uuid | Filter by function |
| `status` | string | Filter by status (comma-separated for multiple) |
| `phase` | string | Filter by phase |
| `priority` | string | `low`, `medium`, `high`, `urgent` |
| `is_billable` | boolean | Filter billable tasks |
| `is_retainer_work` | boolean | Filter retainer work |
| `due_before` | date | Tasks due before date |
| `due_after` | date | Tasks due after date |
| `is_blocked` | boolean | Filter blocked tasks |
| `in_review` | boolean | Filter tasks in review |
| `search` | string | Search name |
| `group_by` | string | `project`, `phase`, `status`, `assignee` |
| `sort` | string | `order`, `created_at`, `due_date`, `priority` |
| `order` | string | `asc`, `desc` |
| `limit` | int | Default 50 |
| `cursor` | string | Pagination cursor |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "task_number": "ACME-42",
      "name": "Design Homepage Mockup",
      "description": "Create Figma mockup...",
      "project_id": "uuid",
      "project": {
        "id": "uuid",
        "name": "Website Redesign"
      },
      "client_id": "uuid",
      "client": {
        "id": "uuid",
        "business_name": "Acme Corp"
      },
      "site_id": "uuid",
      "sop_id": "uuid",
      "function_id": "uuid",
      "function": {
        "id": "uuid",
        "name": "Designer"
      },
      "assignee_id": "uuid",
      "assignee": {
        "id": "uuid",
        "name": "Jane Doe",
        "avatar_url": "https://..."
      },
      "reviewer_id": "uuid",
      "status": "in_progress",
      "phase": "Design",
      "priority": "high",
      "energy_base": 3,
      "energy_mystery_factor": "average",
      "battery_impact": "average_drain",
      "due_date": "2024-01-20",
      "is_billable": true,
      "is_retainer_work": false,
      "no_review": false,
      "created_at": "2024-01-01T00:00:00Z",
      "_computed": {
        "weighted_energy": 3.9,
        "energy_range": "3-5.25",
        "time_spent": 2.5,
        "is_blocked": false,
        "is_ready": true,
        "burndown_percent": 64,
        "requirements_progress": "3/5"
      }
    }
  ],
  "meta": { ... }
}
```

---

### GET `/tasks/:id`
**Purpose:** Get single task with full details.

| Attribute | Value |
|-----------|-------|
| Access | All (billing hidden from Tech) |
| Related Screens | Quest Detail |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "task_number": "ACME-42",
    "name": "Design Homepage Mockup",
    "description": "Create Figma mockup for homepage...",
    "content": { ... },
    "project_id": "uuid",
    "project": { ... },
    "client_id": "uuid",
    "client": { ... },
    "site_id": "uuid",
    "site": { ... },
    "sop_id": "uuid",
    "sop": {
      "id": "uuid",
      "name": "Page Mockup",
      "documentation": { ... }
    },
    "function_id": "uuid",
    "function": { ... },
    "assignee_id": "uuid",
    "assignee": { ... },
    "reviewer_id": "uuid",
    "reviewer": { ... },
    "status": "in_progress",
    "phase": "Design",
    "priority": "high",
    "energy_base": 3,
    "energy_mystery_factor": "average",
    "battery_impact": "average_drain",
    "due_date": "2024-01-20",
    "is_billable": true,
    "is_retainer_work": false,
    "billing_target": "average",
    "no_review": false,
    "no_time_tracking": false,
    "focus": false,
    "blocked_reason": null,
    "date_complete": null,
    "approved": false,
    "invoiced": false,
    "cover_image": "https://...",
    "tags": ["design", "homepage"],
    "requirements": [
      {
        "id": "uuid",
        "text": "Review design brief",
        "completed": true,
        "completed_at": "2024-01-15T10:00:00Z",
        "completed_by": "uuid",
        "sort_order": 1
      },
      {
        "id": "uuid",
        "text": "Create wireframe",
        "completed": true,
        "completed_at": "2024-01-16T14:00:00Z",
        "completed_by": "uuid",
        "sort_order": 2
      },
      {
        "id": "uuid",
        "text": "Design final mockup",
        "completed": false,
        "completed_at": null,
        "completed_by": null,
        "sort_order": 3
      }
    ],
    "blocking": [
      {
        "id": "uuid",
        "task_id": "uuid",
        "task_name": "Build Homepage",
        "status": "not_started"
      }
    ],
    "blocked_by": [],
    "resource_links": [
      {
        "title": "Figma File",
        "url": "https://figma.com/..."
      }
    ],
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-15T00:00:00Z",
    "_computed": {
      "weighted_energy": 3.9,
      "energy_variance": 5.25,
      "energy_range": "3-5.25",
      "time_spent": 2.5,
      "time_range": "3 hrs – 5.25 hrs",
      "is_blocked": false,
      "is_ready": true,
      "burndown_percent": 64,
      "amount_to_bill": 585.00
    }
  }
}
```

---

### POST `/tasks`
**Purpose:** Create new task.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Quest Creation Drawer |

**Request:**
```json
{
  "name": "Design Homepage Mockup",
  "project_id": "uuid",
  "site_id": "uuid",
  "sop_id": "uuid",
  "function_id": "uuid",
  "assignee_id": "uuid",
  "reviewer_id": "uuid",
  "phase": "Design",
  "priority": "high",
  "energy_base": 3,
  "energy_mystery_factor": "average",
  "battery_impact": "average_drain",
  "due_date": "2024-01-20",
  "is_billable": true,
  "no_review": false,
  "copy_requirements_from_sop": true
}
```

**Response (201):** Created task object

**Side Effects:**
- If SOP selected and `copy_requirements_from_sop: true`, requirements populated
- If project has team assignment for function, assignee auto-set
- Inherits client from project/site context
- If ad-hoc (no project) and assignee set, notification sent immediately

---

### PATCH `/tasks/:id`
**Purpose:** Update task.

| Attribute | Value |
|-----------|-------|
| Access | Tech (assigned tasks, limited fields), PM, Admin |
| Related Screens | Quest Detail |

**Request:** Partial task object

**Tech Limited Fields:**
- `status` (within allowed transitions)
- `content`
- `requirements`
- `focus`

**Response (200):** Updated task object

---

### PATCH `/tasks/:id/status`
**Purpose:** Change task status (with side effects).

| Attribute | Value |
|-----------|-------|
| Access | Tech (assigned), PM, Admin |
| Related Screens | Quest Detail, Quest List (inline) |

**Request:**
```json
{
  "status": "in_progress"
}
```

**Special Handling:**
- `blocked`: Requires `blocked_reason` in body
- `done`: If `no_review=false`, auto-changes to `review`
- `review` → `done`: Sets `date_complete`, `approved=true`

**Response (200):** Updated task with notification summary

---

### POST `/tasks/:id/submit-for-review`
**Purpose:** Submit task for review.

| Attribute | Value |
|-----------|-------|
| Access | Tech (assigned), PM |
| Related Screens | Quest Detail |

**Response (200):** Task with status changed to `review`

**Side Effects:**
- Notifies reviewer

---

### POST `/tasks/:id/approve`
**Purpose:** Approve task after review.

| Attribute | Value |
|-----------|-------|
| Access | Reviewer (PM, Admin) |
| Related Screens | PM Dashboard, Quest Detail |

**Response (200):** Task with status changed to `done`

**Side Effects:**
- Sets `approved=true`, `date_complete`
- Notifies assignee

---

### POST `/tasks/:id/return`
**Purpose:** Return task for revisions.

| Attribute | Value |
|-----------|-------|
| Access | Reviewer (PM, Admin) |
| Related Screens | PM Dashboard, Quest Detail |

**Request:**
```json
{
  "comment": "Please revise the hero section..."
}
```

**Response (200):** Task with status changed to `in_progress`

**Side Effects:**
- Creates comment with feedback
- Notifies assignee

---

### DELETE `/tasks/:id`
**Purpose:** Soft delete task.

| Attribute | Value |
|-----------|-------|
| Access | PM (own projects), Admin |
| Related Screens | Quest Detail |

**Response (204):** No content

---

### PUT `/tasks/:id/requirements`
**Purpose:** Replace all requirements for a task.

| Attribute | Value |
|-----------|-------|
| Access | Tech (assigned), PM, Admin |
| Related Screens | Quest Detail (Content tab) |

**Request:**
```json
{
  "requirements": [
    { "text": "Review design brief", "completed": true, "sort_order": 1 },
    { "text": "Create wireframe", "completed": false, "sort_order": 2 }
  ]
}
```

**Response (200):** Updated requirements array

---

### PATCH `/tasks/:id/requirements/:reqId`
**Purpose:** Update single requirement (toggle complete).

| Attribute | Value |
|-----------|-------|
| Access | Tech (assigned), PM, Admin |
| Related Screens | Quest Detail (Content tab) |

**Request:**
```json
{
  "completed": true
}
```

**Response (200):** Updated requirement

---

### GET `/tasks/:id/blockers`
**Purpose:** Get blocker relationships for a task.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Quest Detail (Details tab) |

**Response (200):**
```json
{
  "data": {
    "blocking": [
      { "id": "uuid", "task_id": "uuid", "task_name": "Build Homepage" }
    ],
    "blocked_by": [
      { "id": "uuid", "task_id": "uuid", "task_name": "Content Writing" }
    ]
  }
}
```

---

### POST `/tasks/:id/blockers`
**Purpose:** Add a blocker relationship.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Quest Detail (Details tab) |

**Request:**
```json
{
  "blocked_task_id": "uuid"
}
```

**Response (201):** Created blocker relationship

---

### DELETE `/tasks/:id/blockers/:blockerId`
**Purpose:** Remove a blocker relationship.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Quest Detail (Details tab) |

**Response (204):** No content

**Side Effects:**
- If all blockers removed, notify assignee that task is unblocked

---

### GET `/tasks/:id/time-entries`
**Purpose:** Get time entries for a task.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Quest Detail (Timeclock tab) |

**Response (200):** Array of time entry objects

---

### GET `/tasks/:id/comments`
**Purpose:** Get comments for a task.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Quest Detail (Content tab) |

**Response (200):** Array of comment objects

---

### GET `/tasks/:id/activity`
**Purpose:** Get activity log for a task.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Quest Detail (Activity section) |

**Response (200):** Array of activity log entries

---

### POST `/tasks/bulk-status`
**Purpose:** Change status of multiple tasks.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Quest List (bulk actions) |

**Request:**
```json
{
  "task_ids": ["uuid", "uuid", "uuid"],
  "status": "done"
}
```

**Response (200):**
```json
{
  "data": {
    "updated": 3,
    "failed": 0,
    "errors": []
  }
}
```

---

## 8. Time Entries (Timeclock)

### GET `/time-entries`
**Purpose:** List time entries with filtering.

| Attribute | Value |
|-----------|-------|
| Access | All (own entries), PM/Admin (all) |
| Related Screens | Timekeeper, Quest Detail (Timeclock tab) |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `user_id` | uuid | Filter by user |
| `task_id` | uuid | Filter by task |
| `project_id` | uuid | Filter by project |
| `client_id` | uuid | Filter by client |
| `date_from` | date | Entries from date |
| `date_to` | date | Entries to date |
| `is_running` | boolean | Only running timers |
| `sort` | string | `started_at`, `created_at` |
| `order` | string | `asc`, `desc` |
| `limit` | int | Default 50 |
| `cursor` | string | Pagination cursor |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "user": {
        "id": "uuid",
        "name": "Mike Hansen"
      },
      "task_id": "uuid",
      "task": {
        "id": "uuid",
        "name": "Design Homepage Mockup",
        "project_id": "uuid",
        "project_name": "Website Redesign",
        "client_id": "uuid",
        "client_name": "Acme Corp"
      },
      "started_at": "2024-01-15T09:00:00Z",
      "ended_at": "2024-01-15T11:30:00Z",
      "duration_minutes": 150,
      "notes": "Completed hero section",
      "created_at": "2024-01-15T11:30:00Z"
    }
  ],
  "meta": { ... }
}
```

---

### GET `/time-entries/:id`
**Purpose:** Get single time entry.

| Attribute | Value |
|-----------|-------|
| Access | Own entry, PM, Admin |
| Related Screens | Time entry detail |

**Response (200):** Full time entry object

---

### POST `/time-entries`
**Purpose:** Create manual time entry.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Timekeeper, Quest Detail |

**Request:**
```json
{
  "task_id": "uuid",
  "started_at": "2024-01-15T09:00:00Z",
  "ended_at": "2024-01-15T11:30:00Z",
  "notes": "Completed hero section"
}
```

**Response (201):** Created time entry

**Validation:**
- Task must exist and be accessible
- Started must be before ended
- Cannot overlap with other entries for same user

---

### PATCH `/time-entries/:id`
**Purpose:** Update time entry.

| Attribute | Value |
|-----------|-------|
| Access | Own entry (within 24hrs), PM, Admin |
| Related Screens | Timekeeper |

**Request:** Partial time entry object

**Response (200):** Updated time entry

---

### DELETE `/time-entries/:id`
**Purpose:** Delete time entry.

| Attribute | Value |
|-----------|-------|
| Access | Own entry (within 24hrs), Admin |
| Related Screens | Timekeeper |

**Response (204):** No content

---

### POST `/time-entries/start`
**Purpose:** Start timer for a task.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Timer Widget, Quest Detail |

**Request:**
```json
{
  "task_id": "uuid",
  "notes": "Starting work on hero section"
}
```

**Response (201):**
```json
{
  "data": {
    "id": "uuid",
    "task_id": "uuid",
    "started_at": "2024-01-15T09:00:00Z",
    "ended_at": null,
    "duration_minutes": null,
    "notes": "Starting work on hero section"
  }
}
```

**Side Effects:**
- Auto-stops any running timer for user
- Auto-changes task status to `in_progress` if `not_started`

---

### POST `/time-entries/stop`
**Purpose:** Stop running timer.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Timer Widget |

**Request:**
```json
{
  "notes": "Completed hero section"
}
```

**Response (200):** Completed time entry

---

### GET `/time-entries/active`
**Purpose:** Get current user's active timer.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Timer Widget |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "task_id": "uuid",
    "task": { ... },
    "started_at": "2024-01-15T09:00:00Z",
    "elapsed_minutes": 45
  }
}
```

**Response (204):** No active timer

---

### GET `/time-entries/summary`
**Purpose:** Get time summary for current user.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Timekeeper |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `period` | string | `today`, `week`, `month`, `custom` |
| `date_from` | date | For custom period |
| `date_to` | date | For custom period |

**Response (200):**
```json
{
  "data": {
    "period": "week",
    "total_hours": 32.5,
    "by_day": [
      { "date": "2024-01-15", "hours": 8.5 },
      { "date": "2024-01-16", "hours": 7.0 }
    ],
    "by_client": [
      { "client_id": "uuid", "client_name": "Acme Corp", "hours": 20.5 }
    ],
    "missing_days": ["2024-01-17"]
  }
}
```

---

## 9. SOPs (Runes)

### GET `/sops`
**Purpose:** List all SOPs.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Rune List |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `function_id` | uuid | Filter by owner function |
| `phase` | string | Filter by default phase |
| `review_status` | string | `current`, `due_soon`, `overdue` |
| `search` | string | Search name |
| `tags` | string | Filter by tags (comma-separated) |
| `sort` | string | `name`, `updated_at`, `next_review` |
| `order` | string | `asc`, `desc` |
| `limit` | int | Default 50 |
| `cursor` | string | Pagination cursor |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Page Build",
      "description": "Standard WordPress page build procedure",
      "owner_function_id": "uuid",
      "owner_function": {
        "id": "uuid",
        "name": "WordPress Tech"
      },
      "phase": "Build",
      "function_id": "uuid",
      "function": {
        "id": "uuid",
        "name": "WordPress Tech II"
      },
      "energy_impact": 3,
      "mystery_factor": "average",
      "battery_impact": "average_drain",
      "priority": "medium",
      "estimated_duration": 3,
      "no_review": false,
      "tags": ["wordpress", "build"],
      "last_reviewed": "2024-01-01",
      "review_interval_days": 365,
      "created_at": "2023-01-01T00:00:00Z",
      "updated_at": "2024-01-15T00:00:00Z",
      "_counts": {
        "template_requirements": 5,
        "tasks_created": 42
      },
      "_computed": {
        "next_review": "2025-01-01",
        "review_status": "current"
      }
    }
  ],
  "meta": { ... }
}
```

---

### GET `/sops/:id`
**Purpose:** Get single SOP with full details.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Rune Detail |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "name": "Page Build",
    "description": "Standard WordPress page build procedure",
    "owner_function_id": "uuid",
    "owner_function": { ... },
    "phase": "Build",
    "function_id": "uuid",
    "function": { ... },
    "energy_impact": 3,
    "mystery_factor": "average",
    "battery_impact": "average_drain",
    "priority": "medium",
    "estimated_duration": 3,
    "no_review": false,
    "tags": ["wordpress", "build"],
    "template_requirements": [
      { "id": "uuid", "text": "Review design mockup", "sort_order": 1 },
      { "id": "uuid", "text": "Build page structure", "sort_order": 2 }
    ],
    "documentation": { ... },
    "tool_references": [
      {
        "id": "uuid",
        "tool_id": "uuid",
        "tool": {
          "id": "uuid",
          "name": "Elementor Pro"
        },
        "context": "Use for page building"
      }
    ],
    "last_reviewed": "2024-01-01",
    "review_interval_days": 365,
    "created_at": "2023-01-01T00:00:00Z",
    "updated_at": "2024-01-15T00:00:00Z",
    "_computed": { ... }
  }
}
```

---

### POST `/sops`
**Purpose:** Create new SOP.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Create Rune Modal |

**Request:**
```json
{
  "name": "Page Build",
  "description": "Standard WordPress page build procedure",
  "owner_function_id": "uuid",
  "phase": "Build",
  "function_id": "uuid",
  "energy_impact": 3,
  "mystery_factor": "average",
  "battery_impact": "average_drain",
  "priority": "medium",
  "estimated_duration": 3,
  "no_review": false,
  "tags": ["wordpress", "build"],
  "template_requirements": [
    { "text": "Review design mockup", "sort_order": 1 },
    { "text": "Build page structure", "sort_order": 2 }
  ],
  "documentation": { ... },
  "review_interval_days": 365
}
```

**Response (201):** Created SOP

---

### PATCH `/sops/:id`
**Purpose:** Update SOP.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Edit Rune Modal |

**Request:** Partial SOP object

**Response (200):** Updated SOP

---

### DELETE `/sops/:id`
**Purpose:** Soft delete SOP.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Rune Detail |

**Response (204):** No content

---

### POST `/sops/:id/mark-reviewed`
**Purpose:** Mark SOP as reviewed.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Rune Detail |

**Response (200):** Updated SOP with new `last_reviewed` date

---

### PUT `/sops/:id/template-requirements`
**Purpose:** Replace template requirements for SOP.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Rune Detail |

**Request:**
```json
{
  "requirements": [
    { "text": "Review design mockup", "sort_order": 1 },
    { "text": "Build page structure", "sort_order": 2 }
  ]
}
```

**Response (200):** Updated requirements

---

### PUT `/sops/:id/tool-references`
**Purpose:** Replace tool references for SOP.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Rune Detail |

**Request:**
```json
{
  "references": [
    { "tool_id": "uuid", "context": "Use for page building" }
  ]
}
```

**Response (200):** Updated tool references

---

## 10. Recipes (Rituals)

### GET `/recipes`
**Purpose:** List all recipes.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Ritual List, Pact Wizard (Step 1) |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `category` | string | `website`, `seo`, `maintenance`, etc. |
| `is_active` | boolean | Only active recipes |
| `requires_sitemap` | boolean | Recipes needing page config |
| `search` | string | Search name |
| `sort` | string | `name`, `created_at` |
| `order` | string | `asc`, `desc` |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Standard Website Build",
      "description": "Complete website build from design to launch",
      "category": "website",
      "is_active": true,
      "requires_sitemap": true,
      "estimated_tasks": 24,
      "phases": [
        { "name": "Setup", "order": 1, "icon": "âš™️" },
        { "name": "Content", "order": 2, "icon": "âœ️" },
        { "name": "Design", "order": 3, "icon": "🎨" },
        { "name": "Build", "order": 4, "icon": "📔🔻" },
        { "name": "Launch", "order": 5, "icon": "🚀" }
      ],
      "trigger_description": "Use when starting a new website project",
      "created_at": "2023-01-01T00:00:00Z",
      "updated_at": "2024-01-15T00:00:00Z",
      "_counts": {
        "recipe_tasks": 18,
        "projects_created": 12
      }
    }
  ],
  "meta": { ... }
}
```

---

### GET `/recipes/:id`
**Purpose:** Get single recipe with full details including task templates.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Ritual Detail, Pact Wizard |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "name": "Standard Website Build",
    "description": "Complete website build...",
    "category": "website",
    "is_active": true,
    "requires_sitemap": true,
    "estimated_tasks": 24,
    "phases": [...],
    "documentation": { ... },
    "trigger_description": "Use when...",
    "recipe_tasks": [
      {
        "id": "uuid",
        "recipe_id": "uuid",
        "sop_id": "uuid",
        "sop": {
          "id": "uuid",
          "name": "Project Setup"
        },
        "name": "Project Setup",
        "phase": "Setup",
        "order": 1,
        "task_type": "simple",
        "function_id": "uuid",
        "function": {
          "id": "uuid",
          "name": "Project Manager"
        },
        "is_milestone": false,
        "default_billing_percentage": null,
        "variable_config": null,
        "recurring_config": null,
        "dependencies": []
      },
      {
        "id": "uuid",
        "name": "{{page_type}} Mockup: {{page_name}}",
        "phase": "Design",
        "order": 1,
        "task_type": "variable",
        "function_id": "uuid",
        "variable_config": {
          "type": "per_page",
          "filter": { "needs_mockup": true },
          "creates_dependency_for": "build_tasks"
        }
      }
    ],
    "default_milestones": [
      {
        "name": "Design Approval",
        "default_percentage": 30,
        "trigger_type": "phase_complete",
        "trigger_config": { "phase": "Design" }
      }
    ],
    "created_at": "2023-01-01T00:00:00Z",
    "updated_at": "2024-01-15T00:00:00Z"
  }
}
```

---

### POST `/recipes`
**Purpose:** Create new recipe.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Create Ritual Modal |

**Request:**
```json
{
  "name": "Standard Website Build",
  "description": "Complete website build...",
  "category": "website",
  "is_active": true,
  "requires_sitemap": true,
  "phases": [
    { "name": "Setup", "order": 1, "icon": "âš™️" }
  ],
  "documentation": { ... },
  "trigger_description": "Use when..."
}
```

**Response (201):** Created recipe

---

### PATCH `/recipes/:id`
**Purpose:** Update recipe.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Edit Ritual Modal |

**Request:** Partial recipe object

**Response (200):** Updated recipe

---

### DELETE `/recipes/:id`
**Purpose:** Soft delete recipe.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Ritual Detail |

**Response (204):** No content

---

### GET `/recipes/:id/tasks`
**Purpose:** Get task templates for a recipe.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Ritual Detail |

**Response (200):** Array of recipe task objects

---

### PUT `/recipes/:id/tasks`
**Purpose:** Replace all task templates for a recipe.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Edit Ritual |

**Request:**
```json
{
  "tasks": [
    {
      "name": "Project Setup",
      "sop_id": "uuid",
      "phase": "Setup",
      "order": 1,
      "task_type": "simple",
      "function_id": "uuid",
      "dependencies": []
    }
  ]
}
```

**Response (200):** Updated recipe tasks

---

### POST `/recipes/:id/preview-tasks`
**Purpose:** Preview what tasks would be generated for given pages.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Pact Wizard (Step 5) |

**Request:**
```json
{
  "pages": [
    { "name": "Homepage", "page_type": "homepage", "needs_mockup": true }
  ]
}
```

**Response (200):**
```json
{
  "data": {
    "tasks": [
      { "name": "Homepage Mockup: Homepage", "phase": "Design", "function": "Designer" }
    ],
    "total_count": 24,
    "by_phase": {
      "Setup": 4,
      "Content": 3,
      "Design": 5,
      "Build": 10,
      "Launch": 2
    }
  }
}
```

---

## 11. Functions

### GET `/functions`
**Purpose:** List all functions (job roles).

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Function List, Team Modal |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Search name |
| `sort` | string | `name`, `level` |
| `order` | string | `asc`, `desc` |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Designer",
      "description": "UI/UX design and mockups",
      "level": 2,
      "created_at": "2023-01-01T00:00:00Z",
      "_counts": {
        "users": 3,
        "sops_owned": 5,
        "sops_default": 8
      }
    }
  ]
}
```

---

### GET `/functions/:id`
**Purpose:** Get single function with users.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Function Detail (Peek Drawer) |

**Response (200):**
```json
{
  "data": {
    "id": "uuid",
    "name": "Designer",
    "description": "UI/UX design and mockups",
    "level": 2,
    "users": [
      {
        "id": "uuid",
        "name": "Jane Doe",
        "avatar_url": "https://...",
        "is_primary": true
      }
    ],
    "sops_owned": [...],
    "sops_default": [...],
    "created_at": "2023-01-01T00:00:00Z"
  }
}
```

---

### POST `/functions`
**Purpose:** Create new function.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Create Function Modal |

**Request:**
```json
{
  "name": "Designer",
  "description": "UI/UX design and mockups",
  "level": 2
}
```

**Response (201):** Created function

---

### PATCH `/functions/:id`
**Purpose:** Update function.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Edit Function Modal |

**Request:** Partial function object

**Response (200):** Updated function

---

### DELETE `/functions/:id`
**Purpose:** Delete function (only if no assignments).

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Function Detail |

**Response (204):** No content

**Error:** `409` if function has user assignments

---

### GET `/functions/:id/users`
**Purpose:** Get users assigned to a function.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Team Assignment |

**Response (200):** Array of user objects with `is_primary` flag

---

## 12. Hosting Plans

### GET `/hosting-plans`
**Purpose:** List all hosting plans.

| Attribute | Value |
|-----------|-------|
| Access | All (margins hidden from non-Admin) |
| Related Screens | Hosting Plan List |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Standard",
      "client_rate": 50.00,
      "cost": 15.00,
      "details": "Standard WordPress hosting",
      "created_at": "2023-01-01T00:00:00Z",
      "_counts": {
        "sites": 12
      },
      "_computed": {
        "margin": 35.00,
        "margin_percent": 70
      }
    }
  ]
}
```

**Note:** `cost`, `margin`, `margin_percent` hidden for non-Admin

---

### GET `/hosting-plans/:id`
**Purpose:** Get single hosting plan.

| Attribute | Value |
|-----------|-------|
| Access | All (margins hidden from non-Admin) |
| Related Screens | Hosting Plan Detail (Peek Drawer) |

**Response (200):** Full hosting plan object

---

### POST `/hosting-plans`
**Purpose:** Create hosting plan.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Create Hosting Plan Modal |

**Request:**
```json
{
  "name": "Standard",
  "client_rate": 50.00,
  "cost": 15.00,
  "details": "Standard WordPress hosting"
}
```

**Response (201):** Created hosting plan

---

### PATCH `/hosting-plans/:id`
**Purpose:** Update hosting plan.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Edit Hosting Plan Modal |

**Request:** Partial hosting plan object

**Response (200):** Updated hosting plan

---

### DELETE `/hosting-plans/:id`
**Purpose:** Delete hosting plan (only if not in use).

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Hosting Plan Detail |

**Response (204):** No content

**Error:** `409` if plan has sites assigned

---

## 13. Maintenance Plans

### GET `/maintenance-plans`
**Purpose:** List all maintenance plans.

| Attribute | Value |
|-----------|-------|
| Access | All (agency rate hidden from Tech) |
| Related Screens | Maintenance Plan List |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Basic",
      "client_rate": 150.00,
      "agency_rate": 100.00,
      "support_cap_hours": 1.0,
      "sop_id": "uuid",
      "sop": {
        "id": "uuid",
        "name": "Monthly Maintenance"
      },
      "details": "Basic monthly maintenance",
      "created_at": "2023-01-01T00:00:00Z",
      "_counts": {
        "sites": 8
      }
    }
  ]
}
```

---

### GET `/maintenance-plans/:id`
**Purpose:** Get single maintenance plan.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Maintenance Plan Detail (Peek Drawer) |

**Response (200):** Full maintenance plan object

---

### POST `/maintenance-plans`
**Purpose:** Create maintenance plan.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Create Maintenance Plan Modal |

**Request:**
```json
{
  "name": "Basic",
  "client_rate": 150.00,
  "agency_rate": 100.00,
  "support_cap_hours": 1.0,
  "sop_id": "uuid",
  "details": "Basic monthly maintenance"
}
```

**Response (201):** Created maintenance plan

---

### PATCH `/maintenance-plans/:id`
**Purpose:** Update maintenance plan.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Edit Maintenance Plan Modal |

**Request:** Partial maintenance plan object

**Response (200):** Updated maintenance plan

---

### DELETE `/maintenance-plans/:id`
**Purpose:** Delete maintenance plan (only if not in use).

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Maintenance Plan Detail |

**Response (204):** No content

---

## 14. Tools

### GET `/tools`
**Purpose:** List all tools.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Tool List |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `tool_type` | string | `plugin`, `theme`, `service`, `software` |
| `search` | string | Search name |
| `sort` | string | `name`, `created_at` |
| `order` | string | `asc`, `desc` |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Elementor Pro",
      "license_key": "xxxx-xxxx-xxxx-1234",
      "file_url": "https://elementor.com/download/...",
      "tool_type": "plugin",
      "description": "WordPress page builder",
      "vendor_url": "https://elementor.com",
      "created_at": "2023-01-01T00:00:00Z"
    }
  ]
}
```

**Note:** `license_key` is partially masked in list view

---

### GET `/tools/:id`
**Purpose:** Get single tool with full license key.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Tool Detail (Peek Drawer) |

**Response (200):** Full tool object with unmasked license key

---

### POST `/tools`
**Purpose:** Create tool.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Create Tool Modal |

**Request:**
```json
{
  "name": "Elementor Pro",
  "license_key": "FULL-LICENSE-KEY-HERE",
  "file_url": "https://elementor.com/download/...",
  "tool_type": "plugin",
  "description": "WordPress page builder",
  "vendor_url": "https://elementor.com"
}
```

**Response (201):** Created tool

---

### PATCH `/tools/:id`
**Purpose:** Update tool.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Edit Tool Modal |

**Request:** Partial tool object

**Response (200):** Updated tool

---

### DELETE `/tools/:id`
**Purpose:** Delete tool.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Tool Detail |

**Response (204):** No content

---

## 15. Users & Team

### GET `/users`
**Purpose:** List all users.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Team List |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `role` | string | `admin`, `pm`, `tech` |
| `function_id` | uuid | Filter by function |
| `status` | string | `active`, `inactive` |
| `search` | string | Search name, email |
| `sort` | string | `name`, `created_at`, `role` |
| `order` | string | `asc`, `desc` |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "jane@indelible.agency",
      "name": "Jane Doe",
      "role": "pm",
      "avatar_url": "https://...",
      "phone": "555-123-4567",
      "timezone": "America/New_York",
      "start_date": "2022-06-01",
      "weekly_availability": 40,
      "hourly_cost": 45.00,
      "is_active": true,
      "functions": [
        { "id": "uuid", "name": "Project Manager", "is_primary": true },
        { "id": "uuid", "name": "Designer", "is_primary": false }
      ],
      "created_at": "2022-06-01T00:00:00Z",
      "_computed": {
        "hours_this_week": 32.5,
        "active_tasks": 8
      }
    }
  ],
  "meta": { ... }
}
```

---

### GET `/users/:id`
**Purpose:** Get single user with full details.

| Attribute | Value |
|-----------|-------|
| Access | Admin (or self) |
| Related Screens | User Detail |

**Response (200):** Full user object with functions and stats

---

### POST `/users`
**Purpose:** Create new user.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Create User Modal |

**Request:**
```json
{
  "email": "newuser@indelible.agency",
  "name": "New User",
  "role": "tech",
  "phone": "555-123-4567",
  "timezone": "America/New_York",
  "start_date": "2024-01-15",
  "weekly_availability": 40,
  "hourly_cost": 35.00,
  "functions": [
    { "function_id": "uuid", "is_primary": true }
  ]
}
```

**Response (201):** Created user

**Side Effects:**
- Sends welcome email with password setup link

---

### PATCH `/users/:id`
**Purpose:** Update user.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Edit User Modal |

**Request:** Partial user object

**Response (200):** Updated user

---

### POST `/users/:id/deactivate`
**Purpose:** Deactivate user account.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | User Detail |

**Response (200):** User with `is_active: false`

**Side Effects:**
- Unassigns from all tasks (or reassigns per config)
- Invalidates sessions

---

### POST `/users/:id/reactivate`
**Purpose:** Reactivate user account.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | User Detail |

**Response (200):** User with `is_active: true`

---

### POST `/users/:id/reset-password`
**Purpose:** Send password reset email.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | User Detail |

**Response (200):** Confirmation message

---

### PUT `/users/:id/functions`
**Purpose:** Replace user's function assignments.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | User Detail, Edit User Modal |

**Request:**
```json
{
  "functions": [
    { "function_id": "uuid", "is_primary": true },
    { "function_id": "uuid", "is_primary": false }
  ]
}
```

**Response (200):** Updated function assignments

---

### GET `/users/assignable`
**Purpose:** Get users available for task assignment (for dropdowns).

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Task assignment dropdowns |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `function_id` | uuid | Filter by capability |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Jane Doe",
      "avatar_url": "https://...",
      "functions": [...]
    }
  ]
}
```

---

## 16. Notifications

### GET `/notifications`
**Purpose:** List notifications for current user.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Notification Panel |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `is_read` | boolean | Filter read/unread |
| `type` | string | Filter by notification type |
| `limit` | int | Default 20 |
| `cursor` | string | Pagination cursor |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "task_assigned",
      "title": "New task assigned",
      "message": "You've been assigned to 'Design Homepage'",
      "entity_type": "task",
      "entity_id": "uuid",
      "is_read": false,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "meta": {
    "unread_count": 5,
    ...
  }
}
```

---

### GET `/notifications/unread-count`
**Purpose:** Get unread notification count for badge.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Header bell icon |

**Response (200):**
```json
{
  "data": {
    "count": 5
  }
}
```

---

### PATCH `/notifications/:id/read`
**Purpose:** Mark notification as read.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Notification Panel |

**Response (200):** Updated notification

---

### POST `/notifications/mark-all-read`
**Purpose:** Mark all notifications as read.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Notification Panel |

**Response (200):**
```json
{
  "data": {
    "marked_count": 5
  }
}
```

---

## 17. Comments

### GET `/comments`
**Purpose:** List comments (typically filtered by task).

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Quest Detail (Content tab) |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `task_id` | uuid | Filter by task (required) |
| `sort` | string | `created_at` |
| `order` | string | `asc`, `desc` |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "task_id": "uuid",
      "user_id": "uuid",
      "user": {
        "id": "uuid",
        "name": "Jane Doe",
        "avatar_url": "https://..."
      },
      "content": "Great work on the hero section!",
      "mentions": ["uuid"],
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### POST `/comments`
**Purpose:** Create comment on a task.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Quest Detail |

**Request:**
```json
{
  "task_id": "uuid",
  "content": "Great work on the hero section!",
  "mentions": ["uuid"]
}
```

**Response (201):** Created comment

**Side Effects:**
- Notifies task assignee
- Notifies mentioned users

---

### PATCH `/comments/:id`
**Purpose:** Update comment.

| Attribute | Value |
|-----------|-------|
| Access | Author only |
| Related Screens | Quest Detail |

**Request:**
```json
{
  "content": "Updated comment content"
}
```

**Response (200):** Updated comment

---

### DELETE `/comments/:id`
**Purpose:** Delete comment.

| Attribute | Value |
|-----------|-------|
| Access | Author, Admin |
| Related Screens | Quest Detail |

**Response (204):** No content

---

## 18. Notes

### GET `/notes`
**Purpose:** List notes for an entity.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Entity Detail (Notes tab) |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `entity_type` | string | `client`, `site`, `project` (required) |
| `entity_id` | uuid | Entity ID (required) |
| `include_rolled_up` | boolean | Include notes from children (default true) |
| `sort` | string | `created_at` |
| `order` | string | `asc`, `desc` |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "entity_type": "project",
      "entity_id": "uuid",
      "source_context": "Website Redesign",
      "user_id": "uuid",
      "user": {
        "id": "uuid",
        "name": "Mike Hansen"
      },
      "content": { ... },
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### POST `/notes`
**Purpose:** Create note on an entity.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Entity Detail (Notes tab) |

**Request:**
```json
{
  "entity_type": "project",
  "entity_id": "uuid",
  "content": { ... }
}
```

**Response (201):** Created note

---

### PATCH `/notes/:id`
**Purpose:** Update note.

| Attribute | Value |
|-----------|-------|
| Access | Author, PM, Admin |
| Related Screens | Entity Detail |

**Request:**
```json
{
  "content": { ... }
}
```

**Response (200):** Updated note

---

### DELETE `/notes/:id`
**Purpose:** Delete note.

| Attribute | Value |
|-----------|-------|
| Access | Author, Admin |
| Related Screens | Entity Detail |

**Response (204):** No content

---

## 19. Activity Logs

### GET `/activity`
**Purpose:** Get activity log for an entity.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Entity Detail (Activity tab) |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `entity_type` | string | Entity type (required) |
| `entity_id` | uuid | Entity ID (required) |
| `action` | string | `created`, `updated`, `deleted` |
| `user_id` | uuid | Filter by user |
| `limit` | int | Default 50 |
| `cursor` | string | Pagination cursor |

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "entity_type": "task",
      "entity_id": "uuid",
      "user_id": "uuid",
      "user": {
        "id": "uuid",
        "name": "Jane Doe"
      },
      "action": "updated",
      "field_name": "status",
      "old_value": "not_started",
      "new_value": "in_progress",
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "meta": { ... }
}
```

---

## 20. Search

### GET `/search`
**Purpose:** Global search across all entities.

| Attribute | Value |
|-----------|-------|
| Access | All (results filtered by role) |
| Related Screens | Global Search Modal |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Search query (required) |
| `types` | string | Entity types (comma-separated, default: all) |
| `limit` | int | Results per type (default 5) |

**Response (200):**
```json
{
  "data": {
    "clients": [
      {
        "id": "uuid",
        "business_name": "Acme Corp",
        "breadcrumb": "Acme Corp"
      }
    ],
    "sites": [
      {
        "id": "uuid",
        "name": "Main Website",
        "breadcrumb": "Acme Corp > Main Website"
      }
    ],
    "projects": [
      {
        "id": "uuid",
        "name": "Website Redesign",
        "breadcrumb": "Acme Corp > Main Website > Website Redesign"
      }
    ],
    "tasks": [
      {
        "id": "uuid",
        "name": "Design Homepage",
        "breadcrumb": "Acme Corp > Website Redesign > Design Homepage"
      }
    ],
    "sops": [
      {
        "id": "uuid",
        "name": "Page Build",
        "breadcrumb": "Grimoire > Page Build"
      }
    ]
  }
}
```

---

### GET `/search/recent`
**Purpose:** Get user's recent searches and viewed items.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Global Search Modal, Recent Items |

**Response (200):**
```json
{
  "data": {
    "searches": ["homepage", "acme", "design"],
    "recent_items": [
      {
        "entity_type": "task",
        "entity_id": "uuid",
        "name": "Design Homepage",
        "viewed_at": "2024-01-15T10:00:00Z"
      }
    ]
  }
}
```

---

### POST `/search/track-view`
**Purpose:** Track that user viewed an entity (for recent items).

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Background tracking |

**Request:**
```json
{
  "entity_type": "task",
  "entity_id": "uuid"
}
```

**Response (204):** No content

---

## 21. Reports

### GET `/reports/retainer-usage`
**Purpose:** Get retainer usage report.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Retainer Usage Report |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `month` | string | YYYY-MM (default: current) |
| `pm_id` | uuid | Filter by PM (PM: auto-filtered to own clients) |
| `status` | string | `under`, `approaching`, `over` |

**Response (200):**
```json
{
  "data": [
    {
      "client_id": "uuid",
      "client_name": "Acme Corp",
      "pm_id": "uuid",
      "pm_name": "Sarah Johnson",
      "retainer_hours": 10,
      "hours_used": 8.5,
      "hours_remaining": 1.5,
      "percent_used": 85,
      "status": "approaching",
      "trend": [
        { "month": "2023-11", "hours": 9.5 },
        { "month": "2023-12", "hours": 10.5 },
        { "month": "2024-01", "hours": 8.5 }
      ]
    }
  ],
  "meta": {
    "total_clients": 15,
    "over_count": 2,
    "approaching_count": 5
  }
}
```

---

### GET `/reports/profitability`
**Purpose:** Get profitability report.

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Profitability Report |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `view` | string | `client`, `project`, `overall` |
| `date_from` | date | Start date |
| `date_to` | date | End date |
| `client_id` | uuid | Filter by client |
| `status` | string | Filter by project status |

**Response (200):**
```json
{
  "data": [
    {
      "entity_type": "client",
      "entity_id": "uuid",
      "name": "Acme Corp",
      "revenue": 15000.00,
      "cost": 6750.00,
      "profit": 8250.00,
      "margin_percent": 55
    }
  ],
  "meta": {
    "totals": {
      "revenue": 150000.00,
      "cost": 67500.00,
      "profit": 82500.00,
      "margin_percent": 55
    }
  }
}
```

---

### GET `/reports/project-health`
**Purpose:** Get project health report.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | Project Health Report |

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `health` | string | `on_track`, `at_risk`, `behind` |
| `pm_id` | uuid | Filter by PM |

**Response (200):**
```json
{
  "data": [
    {
      "project_id": "uuid",
      "project_name": "Website Redesign",
      "client_name": "Acme Corp",
      "pm_id": "uuid",
      "pm_name": "Sarah Johnson",
      "status": "in_progress",
      "health": "at_risk",
      "progress_percent": 50,
      "next_milestone": "Design Approval",
      "milestone_date": "2024-01-20",
      "blocked_tasks": 2,
      "assignees_needing_support": [
        { "id": "uuid", "name": "Jane Doe", "blocked_count": 2 }
      ]
    }
  ],
  "meta": {
    "on_track_count": 5,
    "at_risk_count": 3,
    "behind_count": 1
  }
}
```

---

### GET `/reports/export/:report`
**Purpose:** Export report as CSV.

| Attribute | Value |
|-----------|-------|
| Access | PM (some), Admin (all) |
| Related Screens | Report pages |

**Path Parameters:**
- `report`: `retainer-usage`, `profitability`, `project-health`

**Query Parameters:** Same as respective report endpoint

**Response (200):** CSV file download

---

## 22. Dashboard

### GET `/dashboard/tech`
**Purpose:** Get Tech dashboard data.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Tech Overlook |

**Response (200):**
```json
{
  "data": {
    "active_timer": { ... },
    "whats_next": {
      "task_id": "uuid",
      "name": "Design Homepage",
      "project_name": "Website Redesign",
      "client_name": "Acme Corp",
      "priority": "high",
      "energy": 3,
      "due_date": "2024-01-20"
    },
    "my_quests": {
      "ready": [...],
      "in_progress": [...]
    },
    "blocked_upcoming": {
      "blocked": [...],
      "upcoming": [...]
    },
    "time_today": {
      "hours": 4.5,
      "entries": [...]
    },
    "missing_time_entries": ["2024-01-12", "2024-01-13"]
  }
}
```

---

### GET `/dashboard/pm`
**Purpose:** Get PM dashboard data.

| Attribute | Value |
|-----------|-------|
| Access | PM, Admin |
| Related Screens | PM Overlook |

**Response (200):**
```json
{
  "data": {
    "active_timer": { ... },
    "focus_quests": [...],
    "awaiting_review": [...],
    "unassigned_quests": [...],
    "my_pacts": [
      {
        "id": "uuid",
        "name": "Website Redesign",
        "client_name": "Acme Corp",
        "health": "on_track",
        "progress_percent": 50,
        "tasks_count": 24,
        "blocked_count": 1
      }
    ],
    "retainer_alerts": [
      {
        "client_id": "uuid",
        "client_name": "Acme Corp",
        "hours_used": 8.5,
        "hours_total": 10,
        "percent_used": 85,
        "status": "approaching"
      }
    ],
    "recent_items": [...]
  }
}
```

---

### GET `/dashboard/admin`
**Purpose:** Get Admin dashboard data (PM data + extras).

| Attribute | Value |
|-----------|-------|
| Access | Admin |
| Related Screens | Admin Overlook |

**Response (200):**
```json
{
  "data": {
    ...pm_dashboard_data,
    "system_overview": {
      "active_pacts": 12,
      "open_quests": 156,
      "team_members": 6,
      "retainer_clients": 15
    },
    "all_pacts": [...],
    "team_utilization": [
      {
        "user_id": "uuid",
        "name": "Jane Doe",
        "hours_this_week": 32.5,
        "availability": 40,
        "percent_utilized": 81
      }
    ],
    "system_alerts": [
      {
        "type": "domain_expiring",
        "message": "acme.com expires in 30 days",
        "entity_type": "domain",
        "entity_id": "uuid"
      }
    ]
  }
}
```

---

## 23. Preferences

### GET `/preferences`
**Purpose:** Get current user's preferences.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Settings |

**Response (200):**
```json
{
  "data": {
    "naming_convention": "awesome",
    "theme": "system",
    "notification_bundle": true,
    "notification_preferences": {
      "task_assigned": { "in_app": true, "email": true },
      "task_ready": { "in_app": true, "email": false },
      "task_commented": { "in_app": true, "email": true },
      "task_mentioned": { "in_app": true, "email": true },
      "task_returned": { "in_app": true, "email": true },
      "review_ready": { "in_app": true, "email": true },
      "retainer_warning": { "in_app": true, "email": true },
      "milestone_triggered": { "in_app": true, "email": true }
    }
  }
}
```

---

### PATCH `/preferences`
**Purpose:** Update current user's preferences.

| Attribute | Value |
|-----------|-------|
| Access | All |
| Related Screens | Settings, Notification Settings |

**Request:**
```json
{
  "naming_convention": "standard",
  "notification_preferences": {
    "task_commented": { "in_app": true, "email": false }
  }
}
```

**Response (200):** Updated preferences

---

## Appendix: Error Codes

### Standard HTTP Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `204` | No Content |
| `400` | Bad Request (validation error) |
| `401` | Unauthorized (not logged in) |
| `403` | Forbidden (insufficient permissions) |
| `404` | Not Found |
| `409` | Conflict (e.g., can't delete in-use entity) |
| `422` | Unprocessable Entity (business rule violation) |
| `429` | Too Many Requests |
| `500` | Internal Server Error |

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request contains invalid data.",
    "details": {
      "email": ["Email is already in use."],
      "name": ["Name is required."]
    }
  }
}
```

---

## Appendix: Endpoint Summary

### Counts by Domain

| Domain | Endpoints |
|--------|-----------|
| Authentication | 5 |
| Current User | 3 |
| Clients | 8 |
| Sites | 8 |
| Domains | 5 |
| Projects | 16 |
| Tasks | 18 |
| Time Entries | 9 |
| SOPs | 8 |
| Recipes | 7 |
| Functions | 6 |
| Hosting Plans | 5 |
| Maintenance Plans | 5 |
| Tools | 5 |
| Users | 10 |
| Notifications | 4 |
| Comments | 4 |
| Notes | 4 |
| Activity | 1 |
| Search | 3 |
| Reports | 4 |
| Dashboard | 3 |
| Preferences | 2 |
| **Total** | **~138** |

---

## Related Documents

- `notion-schema.md` — Original Notion database schema
- `indelible-app-architecture.md` — Technical architecture
- `indelible-schema-addendum.md` — Schema clarifications
- `indelible-screen-inventory.md` — Complete screen catalog
- `indelible-user-flows.md` — User journey documentation
- `indelible-wireframes-creation-flows.md` — Creation flow wireframes

---