# Phase 8: Notifications & Polish
## Detailed Implementation Guide for Claude Code

**Phase:** 8 of 10  
**Estimated Duration:** 2-3 days  
**Prerequisites:** Phase 7 complete (SOPs & Rich Text working)

---

## ðŸŽ¯ Phase Goal

Build the notification system and polish the user experience. By the end of this phase:
- Users receive in-app notifications for relevant events
- Notifications are bundled to prevent overwhelm (neurodivergent-friendly)
- Global search works across all entities
- User preferences can be configured
- Terminology switching (fantasy/standard) works throughout

---

## ðŸ“š Required Reading

| Document | Sections to Focus On |
|----------|---------------------|
| `indelible-wireframes-global-shell.md` | Notification bell, search bar |
| `indelible-app-architecture.md` | Notification triggers |
| `indelible-component-library.md` | Notification components |
| `Designing_a_Neurodivergent-Optimized_Project_Management_Interface.md` | Bundled notifications rationale |

---

## ðŸ“‹ Phase Checklist

### 8.1 Extend Prisma Schema

#### 8.1.1 Add Notification Model

```prisma
// ============================================
// NOTIFICATIONS
// ============================================

model Notification {
  id            String             @id @default(uuid()) @db.Uuid
  user_id       String             @db.Uuid
  user          User               @relation(fields: [user_id], references: [id], onDelete: Cascade)
  
  // Content
  type          NotificationType
  title         String             @db.VarChar(255)
  message       String?            @db.Text
  
  // Reference
  entity_type   String?            @db.VarChar(50) // 'task', 'project', 'client'
  entity_id     String?            @db.Uuid
  
  // Status
  is_read       Boolean            @default(false)
  read_at       DateTime?
  
  // Bundling
  bundle_key    String?            @db.VarChar(100)
  bundle_count  Int                @default(1)
  
  // Metadata
  created_at    DateTime           @default(now())
  
  @@index([user_id])
  @@index([is_read])
  @@index([bundle_key])
  @@index([created_at])
  @@map("notifications")
}

enum NotificationType {
  task_assigned
  task_status_changed
  task_mentioned
  task_due_soon
  task_overdue
  project_status_changed
  review_requested
  comment_added
  retainer_alert
  system_alert
}
```

- [ ] Run migration

---

### 8.2 Notification System

#### 8.2.1 Notification Service
**Create `/lib/services/notifications.ts`:**

```typescript
import { prisma } from '@/lib/db/prisma';
import { NotificationType } from '@prisma/client';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  bundleKey?: string;
}

export async function createNotification(params: CreateNotificationParams) {
  const { userId, type, title, message, entityType, entityId, bundleKey } = params;

  // If bundling, check for existing recent notification with same bundle key
  if (bundleKey) {
    const existingBundle = await prisma.notification.findFirst({
      where: {
        user_id: userId,
        bundle_key: bundleKey,
        is_read: false,
        created_at: {
          gte: new Date(Date.now() - 30 * 60 * 1000), // Last 30 minutes
        },
      },
    });

    if (existingBundle) {
      // Update bundle count instead of creating new
      return prisma.notification.update({
        where: { id: existingBundle.id },
        data: {
          bundle_count: existingBundle.bundle_count + 1,
          title: `${title} (${existingBundle.bundle_count + 1})`,
          created_at: new Date(), // Bump to top
        },
      });
    }
  }

  return prisma.notification.create({
    data: {
      user_id: userId,
      type,
      title,
      message,
      entity_type: entityType,
      entity_id: entityId,
      bundle_key: bundleKey,
    },
  });
}

// Notification triggers
export async function notifyTaskAssigned(taskId: string, assigneeId: string, assignerName: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true, project: { select: { name: true } } },
  });

  if (!task) return;

  await createNotification({
    userId: assigneeId,
    type: 'task_assigned',
    title: `New task assigned: ${task.title}`,
    message: task.project ? `In project: ${task.project.name}` : undefined,
    entityType: 'task',
    entityId: taskId,
    bundleKey: `task_assigned_${assigneeId}`,
  });
}

export async function notifyTaskStatusChanged(
  taskId: string,
  newStatus: string,
  interestedUserIds: string[]
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true },
  });

  if (!task) return;

  for (const userId of interestedUserIds) {
    await createNotification({
      userId,
      type: 'task_status_changed',
      title: `Task "${task.title}" is now ${newStatus}`,
      entityType: 'task',
      entityId: taskId,
      bundleKey: `task_status_${userId}`,
    });
  }
}

export async function notifyReviewRequested(taskId: string, reviewerIds: string[]) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true, assignee: { select: { name: true } } },
  });

  if (!task) return;

  for (const reviewerId of reviewerIds) {
    await createNotification({
      userId: reviewerId,
      type: 'review_requested',
      title: `Review requested: ${task.title}`,
      message: task.assignee ? `From: ${task.assignee.name}` : undefined,
      entityType: 'task',
      entityId: taskId,
    });
  }
}
```

#### 8.2.2 Notification API Endpoints
- [ ] `GET /api/notifications` â€” List user's notifications
- [ ] `GET /api/notifications/unread-count` â€” Count for badge
- [ ] `PATCH /api/notifications/:id/read` â€” Mark as read
- [ ] `POST /api/notifications/mark-all-read` â€” Mark all as read
- [ ] `DELETE /api/notifications/:id` â€” Delete notification

#### 8.2.3 Notification Hooks
**Create `/lib/hooks/useNotifications.ts`:**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiClient.get('/notifications'),
    refetchInterval: 60000, // Poll every minute
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiClient.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 30000, // Poll every 30 seconds
  });
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.post('/notifications/mark-all-read'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
```

---

### 8.3 Notification UI

#### 8.3.1 Notification Bell (Header)
**Update `/components/layout/Header.tsx`:**
- [ ] Show unread count badge
- [ ] Dropdown with notification list
- [ ] Mark as read on click
- [ ] "Mark all as read" button
- [ ] Link to notification target entity

#### 8.3.2 Notification Components
- [ ] `/components/domain/notifications/NotificationList.tsx`
- [ ] `/components/domain/notifications/NotificationItem.tsx`
- [ ] `/components/domain/notifications/NotificationBadge.tsx`

---

### 8.4 Global Search

#### 8.4.1 Search API Endpoint
**Create `/app/api/search/route.ts`:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const searchTerm = `%${query}%`;

    // Search in parallel
    const [clients, sites, projects, tasks] = await Promise.all([
      prisma.client.findMany({
        where: {
          is_deleted: false,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { primary_contact: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, type: true },
        take: 5,
      }),
      prisma.site.findMany({
        where: {
          is_deleted: false,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { url: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, client: { select: { name: true } } },
        take: 5,
      }),
      prisma.project.findMany({
        where: {
          is_deleted: false,
          name: { contains: query, mode: 'insensitive' },
        },
        select: { id: true, name: true, status: true },
        take: 5,
      }),
      prisma.task.findMany({
        where: {
          is_deleted: false,
          title: { contains: query, mode: 'insensitive' },
          // Apply visibility rules for Tech users
          ...(auth.role === 'tech' && {
            OR: [
              { project_id: null, assignee_id: auth.userId },
              {
                assignee_id: auth.userId,
                project: { status: { in: ['ready', 'in_progress', 'review', 'done'] } },
              },
            ],
          }),
        },
        select: { id: true, title: true, status: true, project: { select: { name: true } } },
        take: 5,
      }),
    ]);

    const results = [
      ...clients.map((c) => ({ type: 'client', id: c.id, title: c.name, subtitle: c.type })),
      ...sites.map((s) => ({ type: 'site', id: s.id, title: s.name, subtitle: s.client?.name })),
      ...projects.map((p) => ({ type: 'project', id: p.id, title: p.name, subtitle: p.status })),
      ...tasks.map((t) => ({ type: 'task', id: t.id, title: t.title, subtitle: t.project?.name })),
    ];

    return NextResponse.json({ results });
  } catch (error) {
    return handleApiError(error);
  }
}
```

#### 8.4.2 Search UI
- [ ] Command palette style (Cmd+K / Ctrl+K)
- [ ] Type-ahead search with debounce
- [ ] Grouped results by entity type
- [ ] Keyboard navigation
- [ ] Navigate to entity on select

**Create `/components/layout/CommandPalette.tsx`:**
- [ ] Modal with search input
- [ ] Results list with icons
- [ ] Recent searches (localStorage)

---

### 8.5 User Preferences

#### 8.5.1 Preferences API
- [ ] `GET /api/users/me/preferences` â€” Get preferences
- [ ] `PATCH /api/users/me/preferences` â€” Update preferences

#### 8.5.2 Preferences UI
**Create `/app/(app)/guild/settings/page.tsx`:**
- [ ] Naming convention toggle (Awesome/Standard)
- [ ] Theme selector (Light/Dim/Dark/System)
- [ ] Notification bundling toggle
- [ ] Other user settings

---

### 8.6 Terminology System

#### 8.6.1 Terminology Hook
**Create `/lib/hooks/useTerminology.ts`:**

```typescript
import { useAuth } from './useAuth';

const TERMS = {
  client: { awesome: 'Patron', standard: 'Client' },
  clients: { awesome: 'Patrons', standard: 'Clients' },
  project: { awesome: 'Pact', standard: 'Project' },
  projects: { awesome: 'Pacts', standard: 'Projects' },
  task: { awesome: 'Quest', standard: 'Task' },
  tasks: { awesome: 'Quests', standard: 'Tasks' },
  sop: { awesome: 'Rune', standard: 'SOP' },
  sops: { awesome: 'Runes', standard: 'SOPs' },
  recipe: { awesome: 'Ritual', standard: 'Template' },
  recipes: { awesome: 'Rituals', standard: 'Templates' },
  dashboard: { awesome: 'Overlook', standard: 'Dashboard' },
  foundry: { awesome: 'Foundry', standard: 'Clients' },
  sanctum: { awesome: 'Sanctum', standard: 'Work' },
  chronicles: { awesome: 'Chronicles', standard: 'Time' },
  grimoire: { awesome: 'Grimoire', standard: 'Knowledge' },
  guild: { awesome: 'Guild', standard: 'Settings' },
} as const;

type TermKey = keyof typeof TERMS;

export function useTerminology() {
  const { user } = useAuth();
  const convention = user?.preferences?.naming_convention || 'awesome';

  function t(key: TermKey): string {
    return TERMS[key][convention];
  }

  return { t, convention };
}
```

#### 8.6.2 Apply Throughout UI
- [ ] Update Sidebar labels
- [ ] Update page titles
- [ ] Update form labels
- [ ] Update empty states

---

### 8.7 Polish Items

#### 8.7.1 Loading States
- [ ] Skeleton loaders for all lists
- [ ] Loading spinner component
- [ ] Optimistic UI feedback

#### 8.7.2 Error States
- [ ] Error boundary component
- [ ] Error toast notifications
- [ ] Retry mechanisms

#### 8.7.3 Empty States
- [ ] Custom empty states per entity
- [ ] Call-to-action buttons
- [ ] Helpful messaging

#### 8.7.4 Accessibility
- [ ] Focus management
- [ ] Keyboard navigation
- [ ] Screen reader labels
- [ ] Color contrast verification

---

## ðŸ§ª Testing Requirements

### Integration Tests
- [ ] `/__tests__/integration/api/notifications.test.ts`
- [ ] `/__tests__/integration/api/search.test.ts`

### E2E Tests
- [ ] Search finds entities correctly
- [ ] Notifications appear and can be dismissed
- [ ] Terminology switching works

---

## âœ… Phase 8 Acceptance Criteria

### Functionality
- [ ] Notifications created for task assignments
- [ ] Notifications bundled within 30-minute window
- [ ] Unread count shows in header
- [ ] Marking as read works
- [ ] Global search returns relevant results
- [ ] Search respects role visibility
- [ ] User preferences save correctly
- [ ] Terminology switches throughout app

### Code Quality
- [ ] Notification service is reusable
- [ ] Search is performant with limits
- [ ] Terminology hook used consistently

---

## ðŸ”œ Next Phase

After completing Phase 8, proceed to **Phase 9: Reports & Data Views**.

---

*Phase 8 Document â€” Last Updated: December 2025*