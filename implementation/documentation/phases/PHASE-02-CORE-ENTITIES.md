# Phase 2: Core Entities (CRUD)
## Detailed Implementation Guide for Claude Code

**Phase:** 2 of 10  
**Estimated Duration:** 3-4 days  
**Prerequisites:** Phase 1 complete (auth working, app shell in place)

---

## 🎯 Phase Goal

Build full CRUD functionality for foundation entities: Patrons (Clients), Sites, Domains, and reference data. By the end of this phase:
- Users can create, view, edit, and soft-delete Patrons, Sites, and Domains
- Reference data (Hosting Plans, Maintenance Plans, Functions, Tools) is manageable by Admin
- React Query hooks provide cached, optimistic data management
- List views with filtering/search are functional
- Detail views with tabbed interfaces are working

---

## 📚 Required Reading

Before starting this phase, the **Reader Agent** must review:

| Document | Sections to Focus On |
|----------|---------------------|
| `indelible-api-endpoint-inventory.md` | Client, Site, Domain endpoints |
| `indelible-data-model-refinement.md` | Clients, Sites, Domains tables |
| `indelible-state-management-plan.md` | React Query setup, query keys |
| `indelible-wireframes-list-views.md` | List view layouts |
| `indelible-wireframes-pact-patron-detail.md` | Detail page tabs |
| `indelible-component-library.md` | Card, Table, Modal components |
| `/implementation/mockups/` | Review relevant mockup folders |

### Before Building UI
1. **Check `/components/ui/`** — Does the element already exist?
2. **Check `/implementation/mockups/`** — Is there a reference implementation?
3. **Build library component first** if needed, then use it

---

## 📋 Phase Checklist

### 2.1 API Layer Setup

#### 2.1.1 Install React Query
- [ ] Already installed in Phase 1, verify in package.json
- [ ] Create React Query provider

**Create `/lib/providers/query-provider.tsx`:**
```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

- [ ] Wrap app with provider in root layout

#### 2.1.2 Create API Client
**Create `/lib/api/client.ts`:**
```typescript
type RequestConfig = {
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
};

class ApiClient {
  private baseUrl = '/api';

  private async request<T>(
    method: string,
    endpoint: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`, window.location.origin);
    
    if (config?.params) {
      Object.entries(config.params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...config?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: 'include',
    });

    if (response.status === 401) {
      // Try to refresh token
      const refreshResponse = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (refreshResponse.ok) {
        // Retry original request
        return this.request<T>(method, endpoint, data, config);
      } else {
        // Redirect to login
        window.location.href = '/login';
        throw new Error('Session expired');
      }
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  get<T>(endpoint: string, config?: RequestConfig): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, config);
  }

  post<T>(endpoint: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('POST', endpoint, data, config);
  }

  patch<T>(endpoint: string, data?: unknown, config?: RequestConfig): Promise<T> {
    return this.request<T>('PATCH', endpoint, data, config);
  }

  delete<T>(endpoint: string, config?: RequestConfig): Promise<T> {
    return this.request<T>('DELETE', endpoint, undefined, config);
  }
}

export const apiClient = new ApiClient();
```

#### 2.1.3 Define Query Key Factory Pattern
**Create `/lib/api/query-keys.ts`:**
```typescript
// Query key factory pattern for consistent cache management

export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (filters: ClientFilters) => [...clientKeys.lists(), filters] as const,
  details: () => [...clientKeys.all, 'detail'] as const,
  detail: (id: string) => [...clientKeys.details(), id] as const,
};

export const siteKeys = {
  all: ['sites'] as const,
  lists: () => [...siteKeys.all, 'list'] as const,
  list: (filters: SiteFilters) => [...siteKeys.lists(), filters] as const,
  details: () => [...siteKeys.all, 'detail'] as const,
  detail: (id: string) => [...siteKeys.details(), id] as const,
  byClient: (clientId: string) => [...siteKeys.all, 'byClient', clientId] as const,
};

export const domainKeys = {
  all: ['domains'] as const,
  lists: () => [...domainKeys.all, 'list'] as const,
  list: (filters: DomainFilters) => [...domainKeys.lists(), filters] as const,
  details: () => [...domainKeys.all, 'detail'] as const,
  detail: (id: string) => [...domainKeys.details(), id] as const,
  bySite: (siteId: string) => [...domainKeys.all, 'bySite', siteId] as const,
};

export const referenceDataKeys = {
  hostingPlans: ['hosting-plans'] as const,
  maintenancePlans: ['maintenance-plans'] as const,
  functions: ['functions'] as const,
  tools: ['tools'] as const,
};

// Filter types
export interface ClientFilters {
  search?: string;
  status?: 'active' | 'inactive' | 'delinquent';
  type?: 'direct' | 'agency_partner' | 'sub_client';
  page?: number;
  limit?: number;
}

export interface SiteFilters {
  search?: string;
  clientId?: string;
  page?: number;
  limit?: number;
}

export interface DomainFilters {
  search?: string;
  siteId?: string;
  page?: number;
  limit?: number;
}
```

---

### 2.2 Extend Prisma Schema

Add remaining entities for Phase 2:

**Update `/prisma/schema.prisma`:**

```prisma
// Add to existing schema...

// ============================================
// CLIENTS (PATRONS)
// ============================================

model Client {
  id                String       @id @default(uuid()) @db.Uuid
  name              String       @db.VarChar(255)
  type              ClientType   @default(direct)
  status            ClientStatus @default(active)
  
  // Contact info
  primary_contact   String?      @db.VarChar(255)
  email             String?      @db.VarChar(255)
  phone             String?      @db.VarChar(50)
  
  // Billing
  retainer_hours    Decimal?     @db.Decimal(5, 2)
  hourly_rate       Decimal?     @db.Decimal(10, 2)
  
  // Relationships
  parent_agency_id  String?      @db.Uuid
  parent_agency     Client?      @relation("AgencySubClients", fields: [parent_agency_id], references: [id])
  sub_clients       Client[]     @relation("AgencySubClients")
  
  // Notes
  notes             String?      @db.Text
  
  // Metadata
  is_deleted        Boolean      @default(false)
  created_at        DateTime     @default(now())
  updated_at        DateTime     @updatedAt
  
  // Relations
  sites             Site[]
  
  @@index([type])
  @@index([status])
  @@index([parent_agency_id])
  @@map("clients")
}

enum ClientType {
  direct
  agency_partner
  sub_client
}

enum ClientStatus {
  active
  inactive
  delinquent
}

// ============================================
// SITES
// ============================================

model Site {
  id                  String    @id @default(uuid()) @db.Uuid
  name                String    @db.VarChar(255)
  url                 String?   @db.VarChar(500)
  
  // Client relationship
  client_id           String    @db.Uuid
  client              Client    @relation(fields: [client_id], references: [id])
  
  // Hosting
  hosted_by           HostedBy  @default(indelible)
  platform            String?   @db.VarChar(100)
  hosting_plan_id     String?   @db.Uuid
  hosting_plan        HostingPlan? @relation(fields: [hosting_plan_id], references: [id])
  
  // Maintenance
  maintenance_plan_id String?   @db.Uuid
  maintenance_plan    MaintenancePlan? @relation(fields: [maintenance_plan_id], references: [id])
  
  // Notes
  notes               String?   @db.Text
  
  // Metadata
  is_deleted          Boolean   @default(false)
  created_at          DateTime  @default(now())
  updated_at          DateTime  @updatedAt
  
  // Relations
  domains             Domain[]
  
  @@index([client_id])
  @@index([hosting_plan_id])
  @@index([maintenance_plan_id])
  @@map("sites")
}

enum HostedBy {
  indelible
  client
  other
}

// ============================================
// DOMAINS
// ============================================

model Domain {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @db.VarChar(255)
  
  // Site relationship
  site_id     String    @db.Uuid
  site        Site      @relation(fields: [site_id], references: [id])
  
  // Domain details
  registrar   String?   @db.VarChar(100)
  expires_at  DateTime?
  is_primary  Boolean   @default(false)
  
  // Notes
  notes       String?   @db.Text
  
  // Metadata
  is_deleted  Boolean   @default(false)
  created_at  DateTime  @default(now())
  updated_at  DateTime  @updatedAt
  
  @@index([site_id])
  @@map("domains")
}

// Update HostingPlan and MaintenancePlan to add relations
// Add to existing models:
// HostingPlan: sites Site[]
// MaintenancePlan: sites Site[]
```

- [ ] Run: `npx prisma migrate dev --name add-clients-sites-domains`
- [ ] Run: `npx prisma generate`

---

### 2.3 Patrons (Clients)

#### 2.3.1 Create Client Types
**Create `/types/entities.ts`:**
```typescript
import { Client, Site, Domain, ClientType, ClientStatus } from '@prisma/client';

// Client types
export type { Client, ClientType, ClientStatus };

export interface ClientWithRelations extends Client {
  sites?: Site[];
  sub_clients?: Client[];
  parent_agency?: Client | null;
  _count?: {
    sites: number;
    sub_clients: number;
  };
}

export interface CreateClientInput {
  name: string;
  type?: ClientType;
  status?: ClientStatus;
  primary_contact?: string;
  email?: string;
  phone?: string;
  retainer_hours?: number;
  hourly_rate?: number;
  parent_agency_id?: string;
  notes?: string;
}

export interface UpdateClientInput extends Partial<CreateClientInput> {}

export interface ClientListResponse {
  clients: ClientWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

#### 2.3.2 Create Client API Endpoints
**Create `/app/api/clients/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatClientResponse } from '@/lib/api/formatters';

const createClientSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['direct', 'agency_partner', 'sub_client']).optional(),
  status: z.enum(['active', 'inactive', 'delinquent']).optional(),
  primary_contact: z.string().max(255).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  retainer_hours: z.number().min(0).optional(),
  hourly_rate: z.number().min(0).optional(),
  parent_agency_id: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    const { searchParams } = new URL(request.url);

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') as any;
    const type = searchParams.get('type') as any;

    const where = {
      is_deleted: false,
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { primary_contact: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status }),
      ...(type && { type }),
    };

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        include: {
          _count: {
            select: { sites: true, sub_clients: true },
          },
          parent_agency: {
            select: { id: true, name: true },
          },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.client.count({ where }),
    ]);

    return NextResponse.json({
      clients: clients.map(formatClientResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createClientSchema.parse(body);

    // Validate parent agency exists if provided
    if (data.parent_agency_id) {
      const parent = await prisma.client.findUnique({
        where: { id: data.parent_agency_id },
      });
      if (!parent || parent.type !== 'agency_partner') {
        throw new ApiError('Invalid parent agency', 400);
      }
    }

    const client = await prisma.client.create({
      data: {
        ...data,
        type: data.type || 'direct',
      },
      include: {
        _count: { select: { sites: true, sub_clients: true } },
      },
    });

    return NextResponse.json(formatClientResponse(client), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
```

**Create `/app/api/clients/[id]/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { formatClientResponse } from '@/lib/api/formatters';

const updateClientSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(['direct', 'agency_partner', 'sub_client']).optional(),
  status: z.enum(['active', 'inactive', 'delinquent']).optional(),
  primary_contact: z.string().max(255).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(50).optional().nullable(),
  retainer_hours: z.number().min(0).optional().nullable(),
  hourly_rate: z.number().min(0).optional().nullable(),
  parent_agency_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(request);

    const client = await prisma.client.findUnique({
      where: { id: params.id, is_deleted: false },
      include: {
        sites: {
          where: { is_deleted: false },
          include: {
            hosting_plan: true,
            maintenance_plan: true,
            _count: { select: { domains: true } },
          },
        },
        sub_clients: {
          where: { is_deleted: false },
          select: { id: true, name: true, status: true },
        },
        parent_agency: {
          select: { id: true, name: true },
        },
        _count: { select: { sites: true, sub_clients: true } },
      },
    });

    if (!client) {
      throw new ApiError('Client not found', 404);
    }

    return NextResponse.json(formatClientResponse(client));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = updateClientSchema.parse(body);

    const client = await prisma.client.update({
      where: { id: params.id },
      data,
      include: {
        _count: { select: { sites: true, sub_clients: true } },
      },
    });

    return NextResponse.json(formatClientResponse(client));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAuth(request);
    requireRole(auth, ['admin']);

    // Soft delete
    await prisma.client.update({
      where: { id: params.id },
      data: { is_deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
```

#### 2.3.3 Create Response Formatters
**Create `/lib/api/formatters.ts`:**
```typescript
import { Client, Site, Domain } from '@prisma/client';

export function formatClientResponse(client: any) {
  return {
    id: client.id,
    name: client.name,
    type: client.type,
    status: client.status,
    primary_contact: client.primary_contact,
    email: client.email,
    phone: client.phone,
    retainer_hours: client.retainer_hours ? Number(client.retainer_hours) : null,
    hourly_rate: client.hourly_rate ? Number(client.hourly_rate) : null,
    parent_agency_id: client.parent_agency_id,
    parent_agency: client.parent_agency || null,
    notes: client.notes,
    sites_count: client._count?.sites ?? client.sites?.length ?? 0,
    sub_clients_count: client._count?.sub_clients ?? 0,
    sites: client.sites,
    sub_clients: client.sub_clients,
    created_at: client.created_at,
    updated_at: client.updated_at,
  };
}

export function formatSiteResponse(site: any) {
  return {
    id: site.id,
    name: site.name,
    url: site.url,
    client_id: site.client_id,
    client: site.client || null,
    hosted_by: site.hosted_by,
    platform: site.platform,
    hosting_plan_id: site.hosting_plan_id,
    hosting_plan: site.hosting_plan || null,
    maintenance_plan_id: site.maintenance_plan_id,
    maintenance_plan: site.maintenance_plan || null,
    notes: site.notes,
    domains_count: site._count?.domains ?? site.domains?.length ?? 0,
    domains: site.domains,
    created_at: site.created_at,
    updated_at: site.updated_at,
  };
}

export function formatDomainResponse(domain: any) {
  return {
    id: domain.id,
    name: domain.name,
    site_id: domain.site_id,
    site: domain.site || null,
    registrar: domain.registrar,
    expires_at: domain.expires_at,
    is_primary: domain.is_primary,
    notes: domain.notes,
    created_at: domain.created_at,
    updated_at: domain.updated_at,
  };
}
```

#### 2.3.4 Create Client React Query Hooks
**Create `/lib/hooks/useClients.ts`:**
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { clientKeys, ClientFilters } from '@/lib/api/query-keys';
import type {
  ClientWithRelations,
  ClientListResponse,
  CreateClientInput,
  UpdateClientInput,
} from '@/types/entities';

export function useClients(filters: ClientFilters = {}) {
  return useQuery({
    queryKey: clientKeys.list(filters),
    queryFn: () => apiClient.get<ClientListResponse>('/clients', { params: filters as any }),
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: clientKeys.detail(id),
    queryFn: () => apiClient.get<ClientWithRelations>(`/clients/${id}`),
    enabled: !!id,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateClientInput) =>
      apiClient.post<ClientWithRelations>('/clients', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateClientInput }) =>
      apiClient.patch<ClientWithRelations>(`/clients/${id}`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
      queryClient.setQueryData(clientKeys.detail(data.id), data);
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/clients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });
}
```

#### 2.3.5 Create Client List Page
- [ ] Create `/app/(app)/foundry/patrons/page.tsx` — List view with search, filters
- [ ] Create `/components/domain/clients/ClientCard.tsx`
- [ ] Create `/components/domain/clients/ClientList.tsx`
- [ ] Create `/components/domain/clients/ClientFilters.tsx`

#### 2.3.6 Create Client Detail Page
- [ ] Create `/app/(app)/foundry/patrons/[id]/page.tsx` — Detail with tabs
- [ ] Create `/components/domain/clients/ClientDetail.tsx`
- [ ] Create `/components/domain/clients/ClientOverviewTab.tsx`
- [ ] Create `/components/domain/clients/ClientSitesTab.tsx`

#### 2.3.7 Create Client Form Modal
- [ ] Create `/components/domain/clients/ClientFormModal.tsx`
- [ ] Include validation with Zod + React Hook Form
- [ ] Handle create and edit modes

---

### 2.4 Sites

#### 2.4.1 Create Site API Endpoints
- [ ] `GET /api/sites` — List with filters
- [ ] `GET /api/sites/:id` — Detail with domains
- [ ] `POST /api/sites` — Create
- [ ] `PATCH /api/sites/:id` — Update
- [ ] `DELETE /api/sites/:id` — Soft delete

#### 2.4.2 Create Site React Query Hooks
- [ ] Create `/lib/hooks/useSites.ts`

#### 2.4.3 Create Site UI Components
- [ ] Create `/app/(app)/foundry/sites/page.tsx`
- [ ] Create `/app/(app)/foundry/sites/[id]/page.tsx`
- [ ] Create `/components/domain/sites/SiteCard.tsx`
- [ ] Create `/components/domain/sites/SiteFormModal.tsx`

---

### 2.5 Domains

#### 2.5.1 Create Domain API Endpoints
- [ ] `GET /api/domains` — List with filters
- [ ] `GET /api/domains/:id` — Detail
- [ ] `POST /api/domains` — Create
- [ ] `PATCH /api/domains/:id` — Update
- [ ] `DELETE /api/domains/:id` — Soft delete

#### 2.5.2 Create Domain React Query Hooks
- [ ] Create `/lib/hooks/useDomains.ts`

#### 2.5.3 Create Domain UI Components
- [ ] Create `/app/(app)/foundry/domains/page.tsx`
- [ ] Create `/components/domain/domains/DomainTable.tsx`
- [ ] Create `/components/domain/domains/DomainFormModal.tsx`

---

### 2.6 Reference Data Management

#### 2.6.1 Hosting Plans CRUD
- [ ] `GET /api/hosting-plans`
- [ ] `POST /api/hosting-plans` (Admin only)
- [ ] `PATCH /api/hosting-plans/:id` (Admin only)
- [ ] `DELETE /api/hosting-plans/:id` (Admin only)
- [ ] Create `/lib/hooks/useHostingPlans.ts`
- [ ] Create management UI in Guild/Settings

#### 2.6.2 Maintenance Plans CRUD
- [ ] Same pattern as hosting plans

#### 2.6.3 Functions CRUD
- [ ] Same pattern as hosting plans

#### 2.6.4 Tools CRUD
- [ ] Same pattern as hosting plans

---

### 2.7 Shared UI Components

**IMPORTANT:** Build these components in `/components/ui/` BEFORE building domain components. Check `/implementation/mockups/` for visual references first.

#### 2.7.1 Generic Components (Library)

These go in `/components/ui/` — generic, reusable, no business logic:

- [ ] `/components/ui/modal.tsx` — Modal dialog wrapper
  - Check mockups for modal styling
  - Variants: default, large, fullscreen
- [ ] `/components/ui/drawer.tsx` — Slide-in drawer (for peek panels)
  - Check mockups for drawer behavior
- [ ] `/components/ui/data-table.tsx` — Table with sorting/pagination
  - Generic table, receives columns config
- [ ] `/components/ui/empty-state.tsx` — Empty state display
  - Icon, title, description, action button
- [ ] `/components/ui/skeleton.tsx` — Loading skeleton shapes
  - Variants: text, card, row, avatar
- [ ] `/components/ui/tabs.tsx` — Tab navigation component
- [ ] `/components/ui/dropdown-menu.tsx` — Dropdown menu

#### 2.7.2 Layout Components

These go in `/components/layout/` — structural, app-specific:

- [ ] `/components/layout/PageHeader.tsx` — Page title + breadcrumb + actions
- [ ] `/components/layout/TabNav.tsx` — Detail page tab navigation
- [ ] `/components/layout/PageContainer.tsx` — Standard page wrapper

#### 2.7.3 Domain Components

These go in `/components/domain/` — business logic, use library components:

```tsx
// CORRECT: Domain component uses library components
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function ClientCard({ client }: { client: Client }) {
  return (
    <Card>
      <Card.Header>
        <span>{client.name}</span>
        <Badge variant={getStatusVariant(client.status)}>
          {client.status}
        </Badge>
      </Card.Header>
      <Card.Body>...</Card.Body>
      <Card.Footer>
        <Button variant="ghost">View</Button>
      </Card.Footer>
    </Card>
  );
}
```

```tsx
// WRONG: Inline styles, not using library
export function ClientCard({ client }: { client: Client }) {
  return (
    <div className="rounded-lg border p-4 shadow">
      <span className="inline-flex rounded-full px-2 py-1 text-xs bg-green-100">
        {client.status}
      </span>
      <button className="px-4 py-2 rounded bg-amber-600 text-white">
        View
      </button>
    </div>
  );
}
```

---

## 🧪 Testing Requirements

### Integration Tests for Clients API

**Create `/__tests__/integration/api/clients.test.ts`:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('Clients API', () => {
  describe('GET /api/clients', () => {
    it('returns paginated list of clients', async () => {
      // Test implementation
    });

    it('filters by status', async () => {
      // Test implementation
    });

    it('requires authentication', async () => {
      // Test implementation
    });
  });

  describe('POST /api/clients', () => {
    it('creates client with valid data', async () => {
      // Test implementation
    });

    it('requires PM or Admin role', async () => {
      // Test implementation
    });

    it('validates required fields', async () => {
      // Test implementation
    });
  });

  // ... more tests
});
```

### Tests for Sites and Domains
- [ ] Similar integration tests for `/api/sites`
- [ ] Similar integration tests for `/api/domains`

---

## âœ… Phase 2 Acceptance Criteria

### Functionality
- [ ] Can view list of Patrons with search and filters
- [ ] Can create new Patron (PM/Admin only)
- [ ] Can edit Patron details
- [ ] Can soft-delete Patron (Admin only)
- [ ] Can view Patron detail with Sites tab
- [ ] Same functionality for Sites
- [ ] Same functionality for Domains
- [ ] Reference data manageable by Admin
- [ ] Client type relationships work (agency partner → sub-clients)

### Code Quality
- [ ] All API endpoints follow patterns from Phase 1
- [ ] React Query hooks follow established pattern
- [ ] No duplicate utility functions
- [ ] TypeScript types for all entities

### Component Library
- [ ] All new UI components added to `/components/ui/`
- [ ] Domain components use library components (no inline styles)
- [ ] Mockups were referenced before building
- [ ] No duplicate styling patterns across components

### Tests
- [ ] Integration tests for all CRUD endpoints
- [ ] Tests pass

### Documentation
- [ ] Utility Registry updated with new formatters, hooks
- [ ] Progress Tracker updated
- [ ] Session Log entry added

---

## 📜 Next Phase

After completing Phase 2, proceed to **Phase 3: Projects & Tasks Core**.

Phase 3 Reference Documents:
- `indelible-api-endpoint-inventory.md` (projects, tasks endpoints)
- `indelible-wireframes-quest-detail.md`
- `indelible-user-flows.md` (task status workflow)

---
