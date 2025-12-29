# Indelible App: Claude Code Master Instructions
## Orchestration Guide for AI-Assisted Development

**Version:** 1.0  
**Date:** December 2025  
**Status:** Active Development Guide

---

## 🎯 Purpose

This document is the **single source of truth** for Claude Code development sessions on Indelible. It provides:
- Master progress tracking
- Coding conventions and standards
- Sub-agent orchestration patterns
- Quality control workflows
- File structure and naming conventions
- Utility function registry

**Read this document completely before any coding session.**

---

## 📚 Document Hierarchy

```
CLAUDE-CODE-MASTER-INSTRUCTIONS.md  ← YOU ARE HERE (read first, always)
│
├── indelible-implementation-plan.md    ← Phase overview and checklists
│
├── Phase-Specific Docs (read per phase):
│   ├── indelible-app-architecture.md       ← Domain entities, business rules
│   ├── indelible-data-model-refinement.md  ← Complete database schema
│   ├── indelible-api-endpoint-inventory.md ← All 138 API endpoints
│   ├── indelible-auth-design.md            ← Auth implementation
│   ├── indelible-state-management-plan.md  ← React Query patterns
│   ├── indelible-wireframes-*.md           ← UI specifications
│   ├── indelible-component-library.md      ← Reusable component catalog
│   ├── indelible-testing-strategy.md       ← Testing approach
│   └── indelible-deployment-devops.md      ← CI/CD and hosting
│
└── Schema References:
    ├── indelible-schema-addendum.md        ← Schema extensions
    └── notion-schema.md                    ← Original Notion structure
```

---

## âœ… Master Progress Tracker

Update this section after each development session.

### Current Phase: [ ] Phase 1 - Foundation

| Phase | Status | Started | Completed | Notes |
|-------|--------|---------|-----------|-------|
| 1. Foundation + Auth | 📲 Not Started | — | — | |
| 2. Core Entities (CRUD) | 📲 Not Started | — | — | |
| 3. Projects & Tasks | 📲 Not Started | — | — | |
| 4. Time Tracking | 📲 Not Started | — | — | |
| 5. Dashboards | 📲 Not Started | — | — | |
| 6. Recipe Wizard | 📲 Not Started | — | — | |
| 7. SOPs & Rich Text | 📲 Not Started | — | — | |
| 8. Notifications & Polish | 📲 Not Started | — | — | |
| 9. Reports & Settings | 📲 Not Started | — | — | |
| 10. Testing & Deployment | 📲 Not Started | — | — | |

**Legend:** 📲 Not Started | 🔄 In Progress | âœ… Complete | âš ️ Blocked

### Session Log

| Session | Date | Phase | Accomplishments | Issues | Next Steps |
|---------|------|-------|-----------------|--------|------------|
| 1 | — | — | — | — | — |

---

## 🏔️ Sub-Agent Orchestration Pattern

Claude Code should use specialized sub-agents for different tasks, coordinating them through a consistent workflow.

### Agent Roles

```
â”Œ─────────────────────────────────────────────────────────────────────────â”
│                        ORCHESTRATOR (Main Agent)                        │
│   - Reads this document and phase requirements                          │
│   - Assigns tasks to sub-agents                                         │
│   - Maintains progress tracking                                         │
│   - Makes architectural decisions                                       │
└─────────────────────────────────────────────────────────────────────────â”˜
        │                    │                    │                    │
        ▼                    ▼                    ▼                    ▼
â”Œ─────────────â”    â”Œ─────────────────â”    â”Œ─────────────â”    â”Œ──────────────â”
│   READER    │    │     WRITER      │    │   REVIEWER  │    │   TESTER     │
│   Agent     │    │     Agent       │    │   Agent     │    │   Agent      │
├─────────────â”¤    ├─────────────────â”¤    ├─────────────â”¤    ├──────────────â”¤
│ - Read docs │    │ - Write code    │    │ - Check for │    │ - Run tests  │
│ - Read code │    │ - Create files  │    │   standards │    │ - Report     │
│ - Search    │    │ - Modify files  │    │ - Verify    │    │   results    │
│   utilities │    │ - Report back   │    │   utilities │    │ - Identify   │
│ - Report    │    │                 │    │ - Flag      │    │   failures   │
│   findings  │    │                 │    │   issues    │    │              │
└─────────────â”˜    └─────────────────â”˜    └─────────────â”˜    └──────────────â”˜
        │                    │                    │                    │
        └────────────────────â”´──────────â”¬─────────â”´────────────────────â”˜
                                        ▼
                              â”Œ─────────────────â”
                              │     FIXER       │
                              │     Agent       │
                              ├─────────────────â”¤
                              │ - Fix issues    │
                              │   from review   │
                              │ - Fix failing   │
                              │   tests         │
                              └─────────────────â”˜
```

### Workflow Pattern

For each task (e.g., "Create client API endpoint"):

```
1. READER AGENT
   └── Read: indelible-api-endpoint-inventory.md (find endpoint spec)
   └── Read: indelible-data-model-refinement.md (find schema)
   └── Search: /lib/utils/ (check for existing utilities)
   └── Search: /lib/api/ (check for similar patterns)
   └── Report: "Found spec for GET /api/clients, uses Prisma client table,
                existing utility: formatClientResponse() in /lib/api/formatters.ts"

2. WRITER AGENT
   └── Input: Reader's report + this document's conventions
   └── Create: /app/api/clients/route.ts
   └── Uses: Existing formatClientResponse() utility
   └── Report: "Created GET /api/clients endpoint following conventions"

3. REVIEWER AGENT
   └── Check: Single responsibility (one route per file)
   └── Check: Uses existing utilities (not duplicating)
   └── Check: Function names match actual exports
   └── Check: Error handling follows patterns
   └── Check: TypeScript types are correct
   └── Report: "PASS" or "ISSUES: [list]"

4. TESTER AGENT
   └── Run: npm run test:unit -- clients
   └── Run: npm run test:integration -- clients
   └── Report: "Tests pass" or "Failures: [list]"
```

For UI tasks (e.g., "Create client card component"):

```
1. READER AGENT
   └── Check: /implementation/mockups/ (find visual reference)
   └── Check: /components/ui/ (does element exist?)
   └── Check: /components/domain/ (does domain component exist?)
   └── Report: "Need Card and Badge from /ui/, Badge exists, Card missing"

2. WRITER AGENT (if library component missing)
   └── FIRST: Create /components/ui/card.tsx (the library component)
   └── THEN: Create /components/domain/clients/ClientCard.tsx (uses Card)
   └── Report: "Created Card in library, then ClientCard using it"

3. REVIEWER AGENT
   └── Check: ALL UI elements come from /components/ui/
   └── Check: NO inline Tailwind for reusable patterns
   └── Check: Component uses CVA for variants
   └── Report: "PASS" or "ISSUES: inline styles found on line X"

5. FIXER AGENT (if issues)
   └── Input: Issues from Reviewer or Tester
   └── Fix: Apply corrections
   └── Return to: Reviewer Agent for re-check
```

### Critical Rules for Agents

1. **NEVER assume a utility function exists** — always search first
2. **NEVER invent function names** — use exact names from source code
3. **ALWAYS search before writing** — check for existing patterns
4. **ALWAYS verify imports exist** — check the actual file exports
5. **ALWAYS use component library** — if element doesn't exist, create it in `/components/ui/` first
6. **NEVER inline UI styles** — every button/card/badge/input comes from the library

---

## 📂 File Structure & Single Responsibility

### Repository Structure

```
/indelible
├── /implementation                   # Reference materials for Claude Code
│   ├── /instructions                 # These instruction documents
│   │   ├── CLAUDE-CODE-MASTER-INSTRUCTIONS.md
│   │   └── /phase-docs
│   │       ├── INDEX.md
│   │       ├── PHASE-01-FOUNDATION.md
│   │       └── ... (all phase documents)
│   └── /mockups                      # Visual mockups with code samples
│       ├── /dashboard-cards
│       │   ├── preview.png           # Visual reference
│       │   └── sample.tsx            # Code sample
│       ├── /task-list
│       ├── /sidebar-nav
│       ├── /client-detail
│       └── /... (other mockups)
│
├── /app                              # Next.js App Router
│   ├── /api                          # API Routes
│   │   ├── /auth
│   │   │   ├── login/route.ts        # POST /api/auth/login
│   │   │   ├── logout/route.ts       # POST /api/auth/logout
│   │   │   ├── refresh/route.ts      # POST /api/auth/refresh
│   │   │   └── me/route.ts           # GET /api/auth/me
│   │   ├── /clients
│   │   │   ├── route.ts              # GET (list), POST (create)
│   │   │   └── /[id]
│   │   │       └── route.ts          # GET, PATCH, DELETE
│   │   └── ... (other entities)
│   │
│   ├── /(auth)                       # Auth pages (unprotected)
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   │
│   └── /(app)                        # App pages (protected)
│       ├── layout.tsx                # App shell with sidebar
│       ├── /overlook                 # Dashboard
│       │   └── page.tsx
│       ├── /foundry                  # Patrons, Sites
│       │   ├── /patrons
│       │   │   ├── page.tsx          # List view
│       │   │   └── /[id]/page.tsx    # Detail view
│       │   └── /sites
│       └── ... (other sections)
│
├── /components                       # React Components
│   ├── /ui                           # Generic UI (shadcn/ui based)
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── card.tsx
│   │   ├── modal.tsx
│   │   ├── drawer.tsx
│   │   └── ... 
│   ├── /domain                       # Domain-specific components
│   │   ├── /clients
│   │   │   ├── ClientCard.tsx
│   │   │   ├── ClientForm.tsx
│   │   │   └── ClientList.tsx
│   │   ├── /tasks
│   │   │   ├── TaskCard.tsx
│   │   │   ├── TaskStatusBadge.tsx
│   │   │   └── TaskForm.tsx
│   │   └── ... (other entities)
│   └── /layout
│       ├── Sidebar.tsx
│       ├── Header.tsx
│       ├── PageHeader.tsx
│       └── TimerWidget.tsx
│
├── /lib                              # Utilities and shared logic
│   ├── /api                          # API utilities
│   │   ├── client.ts                 # Fetch wrapper with auth
│   │   ├── formatters.ts             # Response formatters
│   │   └── errors.ts                 # Error handling
│   ├── /auth                         # Auth utilities
│   │   ├── jwt.ts                    # JWT helpers
│   │   ├── middleware.ts             # Auth middleware
│   │   └── permissions.ts            # Role checking
│   ├── /db                           # Database utilities
│   │   ├── prisma.ts                 # Prisma client singleton
│   │   └── queries/                  # Complex query helpers
│   ├── /hooks                        # Custom React hooks
│   │   ├── useAuth.ts
│   │   ├── useTimer.ts
│   │   └── useClients.ts             # React Query hooks per entity
│   ├── /utils                        # General utilities
│   │   ├── date.ts                   # Date formatting
│   │   ├── string.ts                 # String utilities
│   │   └── validation.ts             # Zod schemas
│   ├── /calculations                 # Business logic
│   │   ├── energy.ts                 # Energy calculations
│   │   ├── retainer.ts               # Retainer tracking
│   │   └── status.ts                 # Status transitions
│   └── /constants                    # App constants
│       ├── statuses.ts
│       ├── roles.ts
│       └── terminology.ts            # Fantasy â†” Standard mapping
│
├── /prisma
│   ├── schema.prisma                 # Database schema
│   └── /migrations
│
├── /types                            # TypeScript types
│   ├── entities.ts                   # Entity types (generated + extended)
│   ├── api.ts                        # API request/response types
│   └── ui.ts                         # UI-specific types
│
└── /__tests__                        # Test files
    ├── /unit
    │   ├── /calculations
    │   └── /utils
    ├── /integration
    │   └── /api
    └── /e2e
```

### Single Responsibility Rules

| File Type | Rule | Example |
|-----------|------|---------|
| **API Routes** | One route file per endpoint group | `/api/clients/route.ts` handles GET (list) and POST (create) |
| **API Route [id]** | One file for single-resource operations | `/api/clients/[id]/route.ts` handles GET, PATCH, DELETE |
| **Page Components** | One page file per route | `/overlook/page.tsx` is the dashboard |
| **UI Components** | One component per file | `button.tsx`, `card.tsx` |
| **Domain Components** | One component per file, grouped by entity | `ClientCard.tsx`, `ClientForm.tsx` |
| **Utilities** | Group related functions, max ~10 functions | `date.ts` has all date utilities |
| **Hooks** | One hook per file | `useClients.ts` |
| **Types** | Group by domain | `entities.ts` has all entity types |

---

## 🧱 Component Library Rules

### ⛔ MANDATORY: Single Source of Truth

**EVERY UI element MUST come from the component library.** No exceptions.

```
â”Œ─────────────────────────────────────────────────────────────────────────────â”
│  RULE: If you need a button, badge, card, input, or ANY reusable element:  │
│                                                                             │
│  1. Check /components/ui/ — Does it exist?                                  │
│     ├── YES → Import and use it                                             │
│     └── NO  → Create it in /components/ui/ FIRST, then use it               │
│                                                                             │
│  NEVER inline styles. NEVER create one-off elements.                        │
│  The library is the SINGLE SOURCE OF TRUTH for all UI elements.             │
└─────────────────────────────────────────────────────────────────────────────â”˜
```

**Why this matters:**
- Consistency: Every button looks the same across the app
- Maintainability: Change once, update everywhere  
- Speed: Don't reinvent the wheel each time
- Quality: Components are tested and refined once

**What happens if you don't follow this:**
- Inconsistent UI across the app
- Bugs that only appear in some places
- Impossible to update styles globally
- Technical debt that compounds

### Component Hierarchy

```
/components/ui/          ← Generic, reusable, NO business logic
    button.tsx           ← Use everywhere buttons are needed
    badge.tsx            ← Status indicators
    card.tsx             ← Container cards
    modal.tsx            ← Dialog modals
    ...

/components/domain/      ← Business-specific, USES /ui/ components
    /clients/
        ClientCard.tsx   ← Uses Card, Badge, Button from /ui/
        ClientForm.tsx   ← Uses Input, Select, Button from /ui/
    ...

/components/layout/      ← App structure, USES /ui/ components
    Sidebar.tsx
    Header.tsx
    ...
```

### Before Building ANY UI

1. **Check mockups first:**
   ```
   /implementation/mockups/{feature}/
   ├── preview.png       ← What it should look like
   └── sample.tsx        ← Reference code (adapt as needed)
   ```

2. **Check if component exists:**
   - Search `/components/ui/` for generic elements
   - Search `/components/domain/` for domain elements

3. **Build library component first:**
   If you need a button/card/badge/input that doesn't exist → create in `/components/ui/`

4. **Then build feature component:**
   Import and compose from `/components/ui/`

### Component Library Standards

**UI Components (`/components/ui/`):**
- Use `class-variance-authority` (CVA) for variants
- Use `cn()` utility for className merging
- Export named components (not default)
- No business logic, no API calls
- Props are generic (children, className, variant, size, etc.)

```tsx
// âœ… CORRECT: Generic UI component
// /components/ui/badge.tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-stone-100 text-stone-800',
        success: 'bg-green-100 text-green-800',
        warning: 'bg-amber-100 text-amber-800',
        error: 'bg-red-100 text-red-800',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>,
  VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

**Domain Components (`/components/domain/`):**
- Import from `/components/ui/`
- Contains business logic
- Receives typed entity props
- May use React Query hooks

```tsx
// âœ… CORRECT: Domain component uses library
// /components/domain/clients/ClientCard.tsx
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Client } from '@/types/entities';

const statusVariants = {
  active: 'success',
  inactive: 'default',
  delinquent: 'error',
} as const;

export function ClientCard({ client }: { client: Client }) {
  return (
    <Card>
      <CardHeader>
        <span className="font-medium">{client.name}</span>
        <Badge variant={statusVariants[client.status]}>
          {client.status}
        </Badge>
      </CardHeader>
      <CardContent>
        <p>{client.primary_contact}</p>
        <Button variant="ghost" size="sm">View Details</Button>
      </CardContent>
    </Card>
  );
}
```

```tsx
// âŒ WRONG: Inline styles, not using library
export function ClientCard({ client }: { client: Client }) {
  return (
    <div className="rounded-lg border border-stone-200 p-4 shadow">
      <div className="flex justify-between">
        <span className="font-medium">{client.name}</span>
        <span className="inline-flex rounded-full px-2 py-1 text-xs bg-green-100 text-green-800">
          {client.status}
        </span>
      </div>
      <button className="mt-2 px-3 py-1 text-sm rounded hover:bg-stone-100">
        View Details
      </button>
    </div>
  );
}
```

### Required UI Library Components (Build in Phase 1)

| Component | File | Variants |
|-----------|------|----------|
| Button | `button.tsx` | primary, secondary, ghost, destructive; sm, md, lg |
| Badge | `badge.tsx` | default, success, warning, error, info |
| Card | `card.tsx` | CardHeader, CardContent, CardFooter |
| Input | `input.tsx` | default, error state |
| Select | `select.tsx` | with options |
| Modal | `modal.tsx` | default, large |
| Drawer | `drawer.tsx` | left, right |
| Skeleton | `skeleton.tsx` | line, card, avatar |
| Spinner | `spinner.tsx` | sm, md, lg |
| EmptyState | `empty-state.tsx` | icon, title, description, action |

### Naming Conventions

| Category | Convention | Examples |
|----------|------------|----------|
| **Files** | kebab-case for utilities, PascalCase for components | `date.ts`, `ClientCard.tsx` |
| **Components** | PascalCase | `TaskCard`, `TimerWidget` |
| **Functions** | camelCase, verb-first | `formatDate()`, `calculateEnergy()` |
| **Hooks** | camelCase, `use` prefix | `useClients()`, `useTimer()` |
| **Types/Interfaces** | PascalCase | `Client`, `TaskStatus` |
| **Constants** | SCREAMING_SNAKE_CASE | `TASK_STATUSES`, `ROLE_PERMISSIONS` |
| **API Routes** | lowercase with hyphens | `/api/time-entries` |
| **Database tables** | snake_case, plural | `clients`, `time_entries` |
| **Database columns** | snake_case | `created_at`, `project_id` |

---

## 📏 Coding Standards

### TypeScript

```typescript
// âœ… GOOD: Explicit types, named exports
export interface ClientListResponse {
  clients: Client[];
  total: number;
  page: number;
}

export function getClients(params: GetClientsParams): Promise<ClientListResponse> {
  // ...
}

// âŒ BAD: Implicit any, default exports for utilities
export default function(params) {
  // ...
}
```

### API Routes

```typescript
// âœ… GOOD: /app/api/clients/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { formatClientResponse } from '@/lib/api/formatters';
import { ApiError, handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    
    const clients = await prisma.client.findMany({
      where: { is_deleted: false },
      orderBy: { name: 'asc' },
    });
    
    return NextResponse.json({
      clients: clients.map(formatClientResponse),
      total: clients.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    requireRole(user, ['pm', 'admin']);
    
    const body = await request.json();
    // Validate with Zod...
    
    const client = await prisma.client.create({ data: body });
    
    return NextResponse.json(formatClientResponse(client), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
```

### React Components

```tsx
// âœ… GOOD: /components/domain/clients/ClientCard.tsx
'use client';

import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/date';
import { useTerminology } from '@/lib/hooks/useTerminology';
import type { Client } from '@/types/entities';

interface ClientCardProps {
  client: Client;
  onClick?: (client: Client) => void;
}

export function ClientCard({ client, onClick }: ClientCardProps) {
  const { t } = useTerminology();
  
  return (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => onClick?.(client)}
    >
      <CardHeader>
        <h3 className="text-lg font-medium">{client.name}</h3>
        <Badge variant={client.status === 'active' ? 'success' : 'default'}>
          {client.status}
        </Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {client.sites_count} {t('site', client.sites_count)}
        </p>
      </CardContent>
    </Card>
  );
}
```

### React Query Hooks

```typescript
// âœ… GOOD: /lib/hooks/useClients.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import type { Client, CreateClientInput } from '@/types/entities';

// Query key factory - ALWAYS use this pattern
export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (filters: ClientFilters) => [...clientKeys.lists(), filters] as const,
  details: () => [...clientKeys.all, 'detail'] as const,
  detail: (id: string) => [...clientKeys.details(), id] as const,
};

export function useClients(filters: ClientFilters = {}) {
  return useQuery({
    queryKey: clientKeys.list(filters),
    queryFn: () => apiClient.get<ClientListResponse>('/api/clients', { params: filters }),
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: clientKeys.detail(id),
    queryFn: () => apiClient.get<Client>(`/api/clients/${id}`),
    enabled: !!id,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateClientInput) => 
      apiClient.post<Client>('/api/clients', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}
```

### Error Handling

```typescript
// âœ… GOOD: /lib/api/errors.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error);
  
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    );
  }
  
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Validation failed', details: error.errors },
      { status: 400 }
    );
  }
  
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}
```

---

## 📧 Utility Function Registry

**CRITICAL: Before writing any utility function, search this registry AND the codebase.**

### Existing Utilities (Update as codebase grows)

| Category | File | Functions | Description |
|----------|------|-----------|-------------|
| **Date** | `/lib/utils/date.ts` | `formatDate()`, `formatDateTime()`, `formatRelativeTime()`, `parseISO()` | Date formatting |
| **String** | `/lib/utils/string.ts` | `slugify()`, `truncate()`, `capitalize()` | String manipulation |
| **API** | `/lib/api/client.ts` | `apiClient.get()`, `apiClient.post()`, `apiClient.patch()`, `apiClient.delete()` | HTTP client |
| **API** | `/lib/api/formatters.ts` | `formatClientResponse()`, `formatProjectResponse()`, `formatTaskResponse()` | Response formatting |
| **API** | `/lib/api/errors.ts` | `ApiError`, `handleApiError()` | Error handling |
| **Auth** | `/lib/auth/jwt.ts` | `signToken()`, `verifyToken()`, `refreshToken()` | JWT operations |
| **Auth** | `/lib/auth/middleware.ts` | `requireAuth()`, `requireRole()`, `getSession()` | Auth middleware |
| **Auth** | `/lib/auth/permissions.ts` | `canViewBilling()`, `canManageUsers()`, `checkPermission()` | Permission checks |
| **Calculations** | `/lib/calculations/energy.ts` | `calculateWeightedEnergy()`, `getMysteryMultiplier()` | Energy/effort math |
| **Calculations** | `/lib/calculations/status.ts` | `canTransitionStatus()`, `getNextStatuses()` | Status transitions |
| **Calculations** | `/lib/calculations/retainer.ts` | `calculateRetainerUsage()`, `checkRetainerThreshold()` | Retainer tracking |
| **DB** | `/lib/db/prisma.ts` | `prisma` (singleton) | Database client |
| **Terminology** | `/lib/constants/terminology.ts` | `TERM_MAP`, `getTerm()` | Fantasy â†” Standard |

### Registering New Utilities

When you create a new utility function:

1. Add it to this table with category, file, function name, description
2. Export it as a named export (not default)
3. Include JSDoc comments
4. Add unit tests

```typescript
// âœ… GOOD: Registerable utility
/**
 * Calculates weighted energy for a task based on mystery factor
 * @param baseEnergy - Base energy estimate (1-8)
 * @param mysteryFactor - Uncertainty level ('none' | 'average' | 'significant' | 'no_idea')
 * @returns Weighted energy value
 */
export function calculateWeightedEnergy(
  baseEnergy: number,
  mysteryFactor: MysteryFactor
): number {
  const multiplier = getMysteryMultiplier(mysteryFactor);
  return baseEnergy * multiplier;
}
```

---

## âœ… Quality Checklist

### Before Submitting Any Code

The **Reviewer Agent** must verify:

#### 1. Single Responsibility
- [ ] Each file has one primary purpose
- [ ] No file exceeds ~200 lines (split if larger)
- [ ] Related logic is grouped in same directory

#### 2. No Utility Duplication
- [ ] Searched `/lib/utils/` before creating new utility
- [ ] Searched codebase for similar functions
- [ ] If new utility created, added to registry above

#### 3. Real Function Names
- [ ] All imported functions exist in source files
- [ ] No assumed/invented function names
- [ ] Verified exports in imported modules

#### 4. Code Standards
- [ ] TypeScript types for all function params/returns
- [ ] Named exports (not default)
- [ ] Error handling follows patterns
- [ ] Console.error only (no console.log in production code)

#### 5. Testing
- [ ] Unit tests for business logic
- [ ] Integration tests for API endpoints
- [ ] Tests actually run and pass

---

## 🧪 Testing Requirements

### Test File Organization

```
/__tests__
├── /unit                          # Fast, isolated tests
│   ├── /calculations
│   │   ├── energy.test.ts         # Tests for /lib/calculations/energy.ts
│   │   └── status.test.ts
│   └── /utils
│       └── date.test.ts
│
├── /integration                   # API + database tests
│   └── /api
│       ├── clients.test.ts
│       └── tasks.test.ts
│
└── /e2e                          # Full user flow tests
    ├── auth.spec.ts
    └── project-wizard.spec.ts
```

### Test Workflow

```
1. WRITER Agent creates code
2. WRITER Agent creates corresponding test file
3. TESTER Agent runs tests:
   
   # Unit tests for specific module
   npm run test:unit -- calculations/energy
   
   # Integration tests for specific API
   npm run test:integration -- api/clients
   
   # All tests
   npm run test

4. TESTER Agent reports results
5. If failures → FIXER Agent addresses issues
6. Loop until all tests pass
```

### Minimum Test Coverage

| Area | Coverage Target |
|------|-----------------|
| `/lib/calculations/` | 90%+ |
| `/lib/auth/` | 90%+ |
| `/app/api/` | 80%+ |
| `/components/domain/` | 60%+ |

---

## 🔄 Phase-by-Phase Checklists

These checklists are synchronized with `indelible-implementation-plan.md`. Update both documents as work progresses.

### Phase 1: Foundation + Auth
**Reference:** `indelible-auth-design.md`, `indelible-data-model-refinement.md`

#### 1.1 Project Setup
- [ ] Initialize Next.js project with TypeScript
- [ ] Configure Tailwind CSS
- [ ] Set up directory structure per this document
- [ ] Configure ESLint + Prettier
- [ ] Set up environment variables (.env.local, .env.example)
- [ ] Initialize Git repository

#### 1.2 Database Setup
- [ ] Create Prisma schema from `indelible-data-model-refinement.md`
- [ ] Configure PostgreSQL connection
- [ ] Enable pgvector extension
- [ ] Generate initial migration
- [ ] Create seed script (functions, plans, test users)
- [ ] **Test:** `npm run db:seed` works

#### 1.3 Authentication
- [ ] Implement `/api/auth/login`
- [ ] Implement `/api/auth/logout`
- [ ] Implement `/api/auth/refresh`
- [ ] Implement `/api/auth/me`
- [ ] Set up JWT with HTTP-only cookies
- [ ] Create `requireAuth()` middleware
- [ ] Create `requireRole()` middleware
- [ ] Build login page
- [ ] **Test:** All auth endpoints have integration tests
- [ ] **Review:** Code follows patterns in this document

#### 1.4 App Shell
- [ ] Create authenticated layout wrapper
- [ ] Build Sidebar component (per `indelible-wireframes-global-shell.md`)
- [ ] Build Header component
- [ ] Create placeholder dashboard pages
- [ ] **Test:** Manual navigation works for all roles
- [ ] **Review:** Components follow naming conventions

**Phase 1 Signoff:**
- [ ] All 1.1-1.4 items checked
- [ ] All tests passing
- [ ] Code reviewed by Reviewer Agent
- [ ] Progress updated in Master Tracker above

---

### Phase 2: Core Entities (CRUD)
**Reference:** `indelible-api-endpoint-inventory.md`, `indelible-wireframes-list-views.md`

#### 2.1 API Layer Setup
- [ ] Set up React Query client
- [ ] Create `/lib/api/client.ts`
- [ ] Create query key factories
- [ ] Set up error handling patterns
- [ ] **Test:** API client handles auth refresh

#### 2.2 Patrons (Clients)
- [ ] API: GET /api/clients (list with filters)
- [ ] API: GET /api/clients/:id (detail)
- [ ] API: POST /api/clients (create)
- [ ] API: PATCH /api/clients/:id (update)
- [ ] API: DELETE /api/clients/:id (soft delete)
- [ ] Hook: `useClients()`, `useClient()`, `useCreateClient()`, etc.
- [ ] UI: Client list page
- [ ] UI: Client detail page with tabs
- [ ] UI: Create/Edit modal
- [ ] **Test:** Integration tests for all endpoints
- [ ] **Test:** Component renders correctly

#### 2.3 Sites
- [ ] API: All CRUD endpoints
- [ ] Hooks: All query/mutation hooks
- [ ] UI: List, detail, create/edit
- [ ] **Test:** All passing

#### 2.4 Domains
- [ ] API: All CRUD endpoints
- [ ] UI: Simple table with create/edit
- [ ] **Test:** All passing

#### 2.5 Reference Data Management
- [ ] Hosting Plans CRUD (Admin only)
- [ ] Maintenance Plans CRUD (Admin only)
- [ ] Functions CRUD (Admin only)
- [ ] Tools CRUD (Admin only)
- [ ] **Test:** Permission checks work

**Phase 2 Signoff:**
- [ ] All 2.1-2.5 items checked
- [ ] All tests passing
- [ ] Code reviewed
- [ ] Utility registry updated
- [ ] Progress updated in Master Tracker

---

*[Continue pattern for Phases 3-10...]*

---

## 🚨 Common Mistakes to Avoid

### 1. Inventing Functions

```typescript
// âŒ BAD: formatClient() doesn't exist
import { formatClient } from '@/lib/api/formatters';

// âœ… GOOD: Verify it exists first, use correct name
import { formatClientResponse } from '@/lib/api/formatters';
```

### 2. Duplicating Utilities

```typescript
// âŒ BAD: Creating new date formatter when one exists
function formatTaskDate(date: Date) {
  return date.toLocaleDateString();
}

// âœ… GOOD: Use existing utility
import { formatDate } from '@/lib/utils/date';
```

### 3. Missing Error Handling

```typescript
// âŒ BAD: No error handling
export async function GET(request: NextRequest) {
  const clients = await prisma.client.findMany();
  return NextResponse.json(clients);
}

// âœ… GOOD: Proper error handling
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const clients = await prisma.client.findMany();
    return NextResponse.json(clients);
  } catch (error) {
    return handleApiError(error);
  }
}
```

### 4. Wrong Import Paths

```typescript
// âŒ BAD: Relative imports from deep nesting
import { Button } from '../../../../components/ui/button';

// âœ… GOOD: Path aliases
import { Button } from '@/components/ui/button';
```

### 5. Missing Types

```typescript
// âŒ BAD: Implicit any
function processTask(task) {
  return task.name;
}

// âœ… GOOD: Explicit types
function processTask(task: Task): string {
  return task.name;
}
```

---

## 📋 Session Startup Checklist

**At the start of each Claude Code session:**

1. [ ] Read this entire document (or refresh key sections)
2. [ ] Check Master Progress Tracker — what phase are we in?
3. [ ] Read the relevant phase section of `indelible-implementation-plan.md`
4. [ ] Read any referenced documents for current phase
5. [ ] Review Utility Registry for existing functions
6. [ ] Plan the session's tasks
7. [ ] Begin with Reader Agent to understand context

**At the end of each session:**

1. [ ] Update Master Progress Tracker
2. [ ] Update Session Log
3. [ ] Update Utility Registry if new utilities added
4. [ ] Run all tests
5. [ ] Commit changes with descriptive message
6. [ ] Note any blockers or next steps

---

## 💨 Quick Reference Links

| What | Where |
|------|-------|
| Database schema | `indelible-data-model-refinement.md` |
| API endpoints | `indelible-api-endpoint-inventory.md` |
| Auth details | `indelible-auth-design.md` |
| React Query patterns | `indelible-state-management-plan.md` |
| UI wireframes | `indelible-wireframes-*.md` |
| Component patterns | `indelible-component-library.md` |
| Test approach | `indelible-testing-strategy.md` |
| Deploy process | `indelible-deployment-devops.md` |

---

*Last Updated: December 2025*
*Document Status: Ready for Claude Code sessions*