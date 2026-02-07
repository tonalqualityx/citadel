# API Routes Guide

Detailed patterns for implementing and maintaining API routes in Indelible.

---

## API Route Implementation Pattern

Every API route follows this structure:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export async function GET(request: NextRequest) {
  try {
    const { userId, role } = await requireAuth();
    // ... logic
    if (!found) {
      throw new ApiError('Not found', 404);
    }
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
```

Key elements:
- `requireAuth()` returns `{ userId, email, role }` — supports both cookie JWT and Bearer API keys
- Zod for input validation
- `handleApiError()` wraps all error responses consistently
- `ApiError` for known error states with HTTP status codes

---

## Response Formatters

When returning entities, use the formatters from `/lib/api/formatters.ts`:

| Formatter | Used For | Notable Fields |
|-----------|----------|----------------|
| `formatTaskResponse()` | Tasks | 40+ fields; calculates `time_spent_minutes` from `time_entries`; `description`/`notes` are JSON (rich text) |
| `formatProjectResponse()` | Projects | Includes `calculated` object (hours, progress); `health` (null for non-active); lazy-imports energy/health calculators |
| `formatClientResponse()` | Clients | `sites_count`, `sub_clients_count` from `_count` |
| `formatSiteResponse()` | Sites | Derives `primary_domain` from domains array; includes hosting/maintenance plan objects |
| `formatDomainResponse()` | Domains | Nested `site.client` object; DNS provider info |
| `formatMilestoneResponse()` | Milestones | `billing_amount`, `billing_status`, trigger/invoice timestamps |
| `formatPhaseResponse()` | Phases | Simple: `id`, `name`, `icon`, `sort_order` |
| `formatTeamAssignmentResponse()` | Team | Nested user + function objects |

---

## Error Handling

### API Routes
Use `handleApiError` and `ApiError` from `/lib/api/errors`:

```typescript
import { handleApiError, ApiError } from '@/lib/api/errors';

// Known errors with status codes
throw new ApiError('Client not found', 404);
throw new ApiError('Not authorized', 403);

// Wrap entire handler
catch (error) {
  return handleApiError(error);
}
```

### Frontend
React Query mutations should use `onError` callbacks with toast notifications.

---

## API Data Requirements

### Tasks Must Include Time Entries
When fetching tasks that will display estimates with progress bars, always include `time_entries`:

```typescript
prisma.task.findMany({
  include: {
    time_entries: {
      where: { is_deleted: false },
      select: { duration: true },
    },
    // ... other includes
  },
});
```

The `formatTaskResponse()` function will calculate `time_spent_minutes` from these entries.

### Dashboard Tasks
Dashboard task lists use `time_logged_minutes` field name (calculated at API level).

---

## API Route Registry (REQUIRED)

### The Rule
**When adding, modifying, or removing any API endpoint, you MUST update the route registry.**

### Why This Matters
The API is consumed by external LLM agents (e.g., Openclaw) that discover available endpoints by calling `GET /api/docs`. If the registry is stale, external tools will fail or miss capabilities.

### Registry Structure
The registry is split into domain files under `lib/api/registry/`:

```
lib/api/registry/
├── index.ts          # Interfaces, apiInfo, apiEnums, combined apiRegistry
├── auth.ts           # /api/auth/* + /api/api-keys/*
├── dashboard.ts      # /api/dashboard/*
├── clients.ts        # /api/clients/*
├── projects.ts       # /api/projects/*, /api/milestones/*
├── tasks.ts          # /api/tasks/*
├── time-entries.ts   # /api/time-entries/*
├── sites.ts          # /api/sites/*, /api/domains/*
├── sops.ts           # /api/sops/*, /api/recipes/*
├── users.ts          # /api/users/*, /api/notifications/*
├── billing.ts        # /api/billing/*, /api/reports/*
├── reference.ts      # /api/functions, hosting-plans, maintenance-plans, dns-providers, tools
├── admin.ts          # /api/admin/*
└── misc.ts           # /api/search, uploads, bug-report, activities, resource-links, settings, webhooks, cron, docs, comments
```

The old `lib/api/registry.ts` re-exports from `./registry/index` for backward compatibility.

### What to Update
- Adding a new route: Add its entry to the correct domain file with `path`, `group`, `methods`, `responseExample`
- Changing query params or body schema: Update the corresponding registry entry
- Removing a route: Remove its registry entry
- Changing auth requirements: Update the `auth` and `roles` fields
- Adding response shape: Add `responseExample` using type-hint conventions (see below)

### Response Shape Conventions

Follow these type-hint conventions in `responseExample`:

| Type | Notation |
|------|----------|
| UUID | `'uuid'` |
| String | `'string'` |
| Number | `'number'` |
| Boolean | `'boolean'` |
| DateTime | `'ISO-8601'` |
| Nullable | `'string\|null'`, `'number\|null'` |
| Enum | `'active\|inactive\|delinquent'` (show actual values) |
| Array | `[{ id: 'uuid', name: 'string' }]` with one example element |
| Nested object | Inline: `client: { id: 'uuid', name: 'string' }` |
| Action response | `{ success: true }` |
| Paginated | `{ items: [...], total: 'number', page: 'number', limit: 'number', totalPages: 'number' }` |

Use `responseNotes` for conditional fields, role differences, or calculated data explanations.

### Two-Tier Docs Endpoint

`GET /api/docs` supports a `group` query parameter:

- **Without `group`** (Tier 1): Returns summary — paths, HTTP methods, one-line summaries, and `availableGroups` list. No response shapes or param details. Cheap discovery call.
- **With `group=tasks`** (Tier 2): Returns full detail for that domain — `responseExample`, `queryParams`, `bodySchema`, `responseNotes`.

---

## Activity Logging

Log significant actions using `/lib/services/activity.ts`:

```typescript
import { logCreate, logUpdate, logDelete, logStatusChange } from '@/lib/services/activity';

// After creating
await logCreate(userId, 'task', taskId, taskTitle);

// After status change
await logStatusChange(userId, 'task', taskId, oldStatus, newStatus);
```
