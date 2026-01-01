# Plan: Core Updates - Patrons, Sites, Domains

## Overview
Improve the Patrons (Clients), Sites, and Domains pages with:
1. **Inline editing** - Remove modals, edit directly on detail pages
2. **Missing fields** - Add schema fields and UI elements
3. **Activity tabs** - Show related projects/tasks on Patron detail pages
4. **Support task flag** - Enable filtering support vs billable work

> **Note**: Move this file to `implementation/code-updates/core-updates.md` after implementation begins.

---

## Phase 1: Schema Changes

### 1.1 Domain Model Updates
Add fields for ownership and DNS tracking:

```prisma
model Domain {
  // ... existing fields ...

  // Ownership - who's account is the domain registered under
  registered_by     String?   @db.VarChar(20)  // 'indelible' | 'client'

  // DNS Management
  dns_provider      String?   @db.VarChar(100) // 'cloudflare', 'godaddy', 'route53', etc.
  dns_managed_by    String?   @db.VarChar(20)  // 'indelible' | 'client'
}
```

### 1.2 DnsProvider Reference Table (Optional)
Create a reference table for DNS providers to allow adding new ones:

```prisma
model DnsProvider {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @db.VarChar(100) @unique
  is_active Boolean  @default(true)
  domains   Domain[]

  @@map("dns_providers")
}
```

### 1.3 Task Model - Support Flag
Add `is_support` flag to distinguish support work:

```prisma
model Task {
  // ... existing fields ...
  is_support        Boolean   @default(false)  // Support task (covered by hosting/maintenance)
}
```

**Note**: `is_retainer_work` exists but has different semantics. `is_support` = maintenance/hosting support (non-billable), `is_retainer_work` = uses client's retainer hours.

---

## Phase 2: API Updates

### 2.1 Domains API
**File**: `app/api/domains/route.ts`, `app/api/domains/[id]/route.ts`

- Add `registered_by`, `dns_provider`, `dns_managed_by` to:
  - Zod validation schemas
  - GET responses (already via formatters)
  - PATCH update logic

### 2.2 Sites API
**File**: `app/api/sites/[id]/route.ts`

- Ensure `hosting_plan_id` is included in responses (already is)
- No changes needed - API already supports all fields

### 2.3 Clients API
**File**: `app/api/clients/[id]/route.ts`

- Add endpoint for client activity: `GET /api/clients/[id]/activity`
  - Returns: projects, tasks (with is_support filter), counts
  - Filters: `status` (open/completed/all), `type` (support/billable/all)

### 2.4 Tasks API
**File**: `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts`

- Add `is_support` to validation schemas and update logic

### 2.5 DNS Providers API (if using reference table)
**File**: `app/api/dns-providers/route.ts` (new)

- GET: List all active providers
- POST: Create new provider (PM/Admin only)

---

## Phase 3: Inline Editing Components

### 3.1 Create Reusable Inline Edit Components
**Directory**: `components/ui/inline-edit/`

Use existing patterns from `task-list-columns.tsx`:
- `InlineText` - Already exists, text input on click
- `InlineSelect` - Dropdown on click
- `InlineTextarea` - Multi-line text on click
- `InlineDate` - Date picker on click

### 3.2 Create Entity-Specific Inline Components
**Directory**: `components/ui/inline-edit/`

- `HostingPlanInlineSelect` - Searchable dropdown for hosting plans
- `MaintenancePlanInlineSelect` - Searchable dropdown for maintenance plans
- `UserInlineSelect` - Searchable dropdown for users (assignees)
- `ClientInlineSelect` - Searchable dropdown for clients
- `DnsProviderInlineSelect` - Searchable/creatable dropdown for DNS providers

---

## Phase 4: Page Updates

### 4.1 Domains Detail Page
**File**: `app/(app)/domains/[id]/page.tsx`

Replace static display with inline-editable fields:

| Field | Component | Notes |
|-------|-----------|-------|
| Name | InlineText | |
| Site | Display only | Can't change site |
| Registrar | InlineText | |
| Registered By | InlineSelect | Options: Indelible, Client |
| DNS Provider | DnsProviderInlineSelect | Searchable + create new |
| DNS Managed By | InlineSelect | Options: Indelible, Client |
| Expires | InlineDate | |
| Is Primary | Toggle/Checkbox | |
| Notes | InlineTextarea | |

Remove "Edit Domain" button - fields are directly editable.

### 4.2 Sites Detail Page
**File**: `app/(app)/sites/[id]/page.tsx`

Replace static display with inline-editable fields:

| Field | Component | Notes |
|-------|-----------|-------|
| Name | InlineText | |
| URL | InlineText | |
| Hosted By | InlineSelect | Indelible, Client, Other |
| Platform | InlineText | WordPress, Shopify, etc. |
| Hosting Plan | HostingPlanInlineSelect | Searchable dropdown |
| Maintenance Plan | MaintenancePlanInlineSelect | Searchable |
| Maintenance Assignee | UserInlineSelect | Searchable |
| Notes | InlineTextarea | |

Remove "Edit Site" button.

### 4.3 Clients/Patrons Detail Page
**File**: `app/(app)/clients/[id]/page.tsx`

**Structure Change**: Add tabs - Details | Activity

#### Details Tab (default)
Inline-editable fields:

| Field | Component | Notes |
|-------|-----------|-------|
| Name | InlineText | |
| Type | InlineSelect | Direct, Agency Partner, Sub-Client |
| Status | InlineSelect | Active, Inactive, Delinquent |
| Primary Contact | InlineText | |
| Email | InlineText | |
| Phone | InlineText | |
| Retainer Hours | InlineText (number) | Per month |
| Hourly Rate | InlineText (currency) | **Currently missing from display** |
| Parent Agency | ClientInlineSelect | Only if type=sub_client |
| Notes | InlineTextarea | |

#### Activity Tab
**New component**: `components/domain/clients/client-activity-tab.tsx`

Sections:
1. **Projects** - List of client's projects with status badges
2. **Tasks** - Filterable list (Open/Completed, Support/Billable/All)
3. **Summary Stats** - Open projects, open tasks, support tasks this month

### 4.4 Lists Pages (Optional Enhancement)
Consider adding inline editing to list views for quick updates:
- Domains list: Quick edit registrar, expiration
- Sites list: Quick edit hosting plan
- Clients list: Quick edit status, retainer hours

---

## Phase 5: Hooks & Types Updates

### 5.1 Type Definitions
**File**: `types/entities.ts`

```typescript
// Add to Domain interface
interface Domain {
  // ... existing ...
  registered_by: 'indelible' | 'client' | null;
  dns_provider: string | null;
  dns_managed_by: 'indelible' | 'client' | null;
}

// Add to Task interface
interface Task {
  // ... existing ...
  is_support: boolean;
}

// New interface
interface ClientActivity {
  projects: ProjectSummary[];
  tasks: TaskSummary[];
  stats: {
    open_projects: number;
    open_tasks: number;
    support_tasks_this_month: number;
  };
}
```

### 5.2 Hooks
**File**: `lib/hooks/use-clients.ts`

Add: `useClientActivity(clientId, filters)`

**File**: `lib/hooks/use-dns-providers.ts` (new, if using reference table)

Add: `useDnsProviders()`, `useCreateDnsProvider()`

---

## Implementation Order

### Step 1: Schema & Database
1. [ ] Add Domain fields to schema
2. [ ] Add Task.is_support to schema
3. [ ] Run `prisma db push` and `prisma generate`
4. [ ] Update database-backup.ts if new tables added

### Step 2: API Layer
5. [ ] Update Domain API routes (validation + responses)
6. [ ] Update Task API routes (is_support field)
7. [ ] Create Client Activity endpoint
8. [ ] Create DNS Providers API (if using reference table)

### Step 3: Inline Edit Components
9. [ ] Create/verify InlineText, InlineSelect, InlineTextarea components
10. [ ] Create HostingPlanInlineSelect
11. [ ] Create DnsProviderInlineSelect (with create option)
12. [ ] Create UserInlineSelect

### Step 4: Domain Detail Page
13. [ ] Refactor to inline editing
14. [ ] Add new fields (registered_by, dns_provider, dns_managed_by)
15. [ ] Remove edit button/modal
16. [ ] Write tests

### Step 5: Site Detail Page
17. [ ] Refactor to inline editing
18. [ ] Add Hosting Plan selector
19. [ ] Remove edit button/modal
20. [ ] Write tests

### Step 6: Client Detail Page
21. [ ] Add tab navigation (Details | Activity)
22. [ ] Refactor Details tab to inline editing
23. [ ] Add hourly_rate display
24. [ ] Create Activity tab component
25. [ ] Implement activity data fetching
26. [ ] Remove edit button/modal
27. [ ] Write tests

### Step 7: Cleanup & Polish
28. [ ] Remove unused form modal components
29. [ ] Update any navigation that opened modals
30. [ ] Run full test suite
31. [ ] Manual testing of all pages

---

## Files to Create

| File | Purpose |
|------|---------|
| `components/ui/inline-edit/inline-textarea.tsx` | Multi-line inline edit |
| `components/ui/inline-edit/hosting-plan-select.tsx` | Hosting plan dropdown |
| `components/ui/inline-edit/dns-provider-select.tsx` | DNS provider dropdown |
| `components/ui/inline-edit/user-select.tsx` | User/assignee dropdown |
| `components/domain/clients/client-activity-tab.tsx` | Activity tab content |
| `app/api/clients/[id]/activity/route.ts` | Client activity endpoint |
| `app/api/dns-providers/route.ts` | DNS providers CRUD (optional) |
| `lib/hooks/use-dns-providers.ts` | DNS providers hooks (optional) |

## Files to Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add Domain fields, Task.is_support |
| `app/api/domains/route.ts` | Update validation schema |
| `app/api/domains/[id]/route.ts` | Update validation + PATCH |
| `app/api/tasks/[id]/route.ts` | Add is_support to allowed fields |
| `app/(app)/domains/[id]/page.tsx` | Refactor to inline editing |
| `app/(app)/sites/[id]/page.tsx` | Refactor + add hosting plan |
| `app/(app)/clients/[id]/page.tsx` | Refactor + add tabs |
| `types/entities.ts` | Add new types |
| `lib/api/formatters.ts` | Update domain formatter |
| `lib/hooks/use-domains.ts` | Update types |
| `lib/hooks/use-clients.ts` | Add useClientActivity |
| `lib/services/database-backup.ts` | Add dns_providers if created |

---

## Testing Checklist

- [ ] Domain inline editing saves correctly
- [ ] Site hosting plan selection works
- [ ] Client details tab shows all fields including hourly_rate
- [ ] Client activity tab loads projects and tasks
- [ ] Task support flag filters correctly
- [ ] DNS provider can be selected and created
- [ ] All existing unit tests pass
- [ ] New inline edit components have tests
