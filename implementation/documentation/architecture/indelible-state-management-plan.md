# Indelible App: State Management Plan
## Phase 3.3 Technical Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** âœ… Complete

---

## Overview

This document defines the frontend state architecture for Indelible, establishing clear boundaries between different state categories, caching strategies, and patterns for keeping the UI responsive and consistent.

### Technology Stack

| Concern | Solution |
|---------|----------|
| Server state | TanStack Query (React Query v5) |
| Client state | React Context + useReducer (minimal) |
| Form state | React Hook Form |
| URL state | Next.js router (or React Router) |

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Server state is the source of truth** | Minimize client-side duplication; let React Query cache handle it |
| **Optimistic by default for micro-interactions** | Timer start/stop, checkbox toggles, status changes |
| **Stale-while-revalidate** | Show cached data immediately, refresh in background |
| **Minimal global client state** | Only truly global UI concerns (sidebar collapsed, active timer reference) |

### Real-Time Requirements

| Requirement | Approach |
|-------------|----------|
| Data freshness | 30-60 second tolerance via polling |
| Offline support | Not required for MVP |
| Multi-tab sync | Basic (window focus refetch); enhanced sync deferred |

---

## Table of Contents

1. [State Categories](#1-state-categories)
2. [React Query Configuration](#2-react-query-configuration)
3. [Query Key Conventions](#3-query-key-conventions)
4. [Caching Strategy by Entity](#4-caching-strategy-by-entity)
5. [Mutation Patterns](#5-mutation-patterns)
6. [Optimistic UI Patterns](#6-optimistic-ui-patterns)
7. [Form State Handling](#7-form-state-handling)
8. [Global Client State](#8-global-client-state)
9. [Real-Time Updates](#9-real-time-updates)
10. [Multi-Tab Considerations](#10-multi-tab-considerations)

---

## 1. State Categories

All application state falls into one of these categories:

### Server State (React Query)

Data that lives on the server and is fetched/cached by the client.

| Examples | Characteristics |
|----------|-----------------|
| Entity lists (clients, projects, tasks) | Paginated, filterable |
| Entity details | Single record with nested data |
| Dashboard aggregations | Computed data, role-specific |
| User profile & preferences | Current user data |
| Notifications | List with read/unread state |

### Client State (React Context)

UI state that doesn't persist to the server but needs to be shared across components.

| Examples | Scope |
|----------|-------|
| Sidebar collapsed/expanded | Global |
| Active timer reference (task ID) | Global |
| Current theme preference | Global (synced to user prefs) |
| Modal/drawer open state | Usually local, sometimes global |

### Local Component State (useState)

Ephemeral UI state scoped to a single component.

| Examples |
|----------|
| Dropdown open/closed |
| Hover states |
| Text input before submission |
| Accordion expanded sections |

### URL State (Router)

State that should persist in the URL for shareability and browser navigation.

| Examples | URL Pattern |
|----------|-------------|
| Current entity being viewed | `/pacts/:id` |
| Active tab on detail page | `/pacts/:id?tab=time` |
| List filters | `/quests?status=in_progress&assignee=me` |
| Search query | `/search?q=homepage` |
| Pagination cursor | `/patrons?cursor=abc123` |

### Form State (React Hook Form)

Temporary state during form editing, before submission.

| Examples |
|----------|
| Quest creation form fields |
| Inline edit values |
| Wizard step data |

---

## 2. React Query Configuration

### Global Defaults

```typescript
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data considered fresh for 30 seconds
      staleTime: 30 * 1000,
      
      // Keep unused data in cache for 5 minutes
      gcTime: 5 * 60 * 1000,
      
      // Retry failed requests twice
      retry: 2,
      
      // Refetch on window focus (after stale)
      refetchOnWindowFocus: true,
      
      // Don't refetch on mount if data is fresh
      refetchOnMount: true,
    },
    mutations: {
      // Retry mutations once on network error
      retry: 1,
    },
  },
});
```

### Stale Time Philosophy

| Data Type | Stale Time | Rationale |
|-----------|------------|-----------|
| Dashboard data | 30s | Should feel fresh, refetch on focus |
| Entity lists | 30s | New items should appear reasonably quickly |
| Entity details | 60s | Less likely to change while viewing |
| Static lookups (functions, hosting plans) | 5min | Rarely changes |
| Current user profile | 5min | Only changes on explicit update |
| Active timer status | 0s (always stale) | Critical to be accurate |

---

## 3. Query Key Conventions

Consistent query keys enable predictable cache invalidation.

### Key Structure

```typescript
// Pattern: [domain, scope, identifier?, filters?]

// Lists
['clients', 'list']
['clients', 'list', { status: 'active', pm: 'uuid' }]
['projects', 'list', { clientId: 'uuid' }]
['tasks', 'list', { projectId: 'uuid', status: 'ready' }]

// Details
['clients', 'detail', 'uuid']
['projects', 'detail', 'uuid']
['tasks', 'detail', 'uuid']

// Nested resources
['projects', 'detail', 'uuid', 'tasks']
['projects', 'detail', 'uuid', 'milestones']
['projects', 'detail', 'uuid', 'time-summary']
['tasks', 'detail', 'uuid', 'time-entries']
['tasks', 'detail', 'uuid', 'comments']

// Dashboard / aggregations
['dashboard', 'tech']
['dashboard', 'pm']
['dashboard', 'admin']

// Current user
['user', 'me']
['user', 'me', 'preferences']
['user', 'me', 'notifications']

// Static lookups
['functions', 'list']
['hosting-plans', 'list']
['maintenance-plans', 'list']

// Timer (special case)
['timer', 'active']
```

### Query Key Factory

```typescript
// lib/queryKeys.ts
export const queryKeys = {
  clients: {
    all: ['clients'] as const,
    lists: () => [...queryKeys.clients.all, 'list'] as const,
    list: (filters?: ClientFilters) => 
      [...queryKeys.clients.lists(), filters] as const,
    details: () => [...queryKeys.clients.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.clients.details(), id] as const,
  },
  
  projects: {
    all: ['projects'] as const,
    lists: () => [...queryKeys.projects.all, 'list'] as const,
    list: (filters?: ProjectFilters) => 
      [...queryKeys.projects.lists(), filters] as const,
    details: () => [...queryKeys.projects.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.projects.details(), id] as const,
    tasks: (id: string) => [...queryKeys.projects.detail(id), 'tasks'] as const,
    timeSummary: (id: string) => 
      [...queryKeys.projects.detail(id), 'time-summary'] as const,
  },
  
  tasks: {
    all: ['tasks'] as const,
    lists: () => [...queryKeys.tasks.all, 'list'] as const,
    list: (filters?: TaskFilters) => 
      [...queryKeys.tasks.lists(), filters] as const,
    details: () => [...queryKeys.tasks.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.tasks.details(), id] as const,
    timeEntries: (id: string) => 
      [...queryKeys.tasks.detail(id), 'time-entries'] as const,
    comments: (id: string) => 
      [...queryKeys.tasks.detail(id), 'comments'] as const,
  },
  
  timer: {
    active: ['timer', 'active'] as const,
  },
  
  dashboard: {
    tech: ['dashboard', 'tech'] as const,
    pm: ['dashboard', 'pm'] as const,
    admin: ['dashboard', 'admin'] as const,
  },
  
  user: {
    me: ['user', 'me'] as const,
    preferences: ['user', 'me', 'preferences'] as const,
    notifications: ['user', 'me', 'notifications'] as const,
  },
};
```

---

## 4. Caching Strategy by Entity

### Clients (Patrons)

| Query | Stale Time | Notes |
|-------|------------|-------|
| List | 30s | Refetch on focus |
| Detail | 60s | Include nested sites in response |
| Sites (nested) | Included in detail | No separate query |

**Invalidation triggers:**
- Create/update/delete client â†’ invalidate `clients.lists()`
- Update client â†’ invalidate `clients.detail(id)`

### Projects (Pacts)

| Query | Stale Time | Notes |
|-------|------------|-------|
| List | 30s | Heavy filtering, paginated |
| Detail | 60s | Main project data |
| Tasks | 30s | Separate query, frequently updated |
| Time Summary | 60s | Aggregated, changes with time entries |
| Milestones | 60s | Rarely changes |

**Invalidation triggers:**
- Create project â†’ invalidate `projects.lists()`
- Update project â†’ invalidate `projects.detail(id)`, `projects.lists()`
- Status change â†’ also invalidate `dashboard.*`
- Task changes â†’ invalidate `projects.tasks(id)`
- Time entry changes â†’ invalidate `projects.timeSummary(id)`

### Tasks (Quests)

| Query | Stale Time | Notes |
|-------|------------|-------|
| List (global) | 30s | Dashboard and Quests page |
| List (by project) | 30s | Project detail tab |
| Detail | 60s | Full task with requirements, dependencies |
| Time Entries | 30s | Frequently updated |
| Comments | 30s | May have new comments |

**Invalidation triggers:**
- Create task â†’ invalidate `tasks.lists()`, `projects.tasks(projectId)`
- Update task â†’ invalidate `tasks.detail(id)`, relevant lists
- Status change â†’ also invalidate `dashboard.*`
- Assignment change â†’ invalidate assignee's dashboard
- Time entry CRUD â†’ invalidate `tasks.timeEntries(id)`, `tasks.detail(id)` (for computed time)

### Timer

| Query | Stale Time | Notes |
|-------|------------|-------|
| Active timer | 0s | Always refetch, critical accuracy |

**Special handling:**
- Timer query returns `null` if no active timer
- On timer start â†’ optimistic update, then refetch
- On timer stop â†’ optimistic clear, then refetch
- Refetch on window focus (catches timer stopped in another tab)

---

## 5. Mutation Patterns

### Standard Mutation Structure

```typescript
// hooks/useUpdateTask.ts
export function useUpdateTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: UpdateTaskInput) => api.tasks.update(data.id, data),
    
    onSuccess: (updatedTask) => {
      // Update the detail cache directly
      queryClient.setQueryData(
        queryKeys.tasks.detail(updatedTask.id),
        updatedTask
      );
      
      // Invalidate lists (will refetch in background)
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.lists(),
      });
      
      // Invalidate project's task list if applicable
      if (updatedTask.project_id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.tasks(updatedTask.project_id),
        });
      }
    },
    
    onError: (error) => {
      // Toast notification handled by global error handler
      console.error('Failed to update task:', error);
    },
  });
}
```

### Invalidation Matrix

| Action | Invalidate |
|--------|------------|
| Create client | `clients.lists()` |
| Update client | `clients.detail(id)`, `clients.lists()` |
| Delete client | `clients.lists()` |
| Create project | `projects.lists()`, `clients.detail(clientId)` |
| Update project | `projects.detail(id)`, `projects.lists()` |
| Update project status | Above + `dashboard.*` |
| Create task | `tasks.lists()`, `projects.tasks(projectId)`, `dashboard.*` |
| Update task | `tasks.detail(id)`, `tasks.lists()` |
| Update task status | Above + `dashboard.*` |
| Update task assignee | Above + `dashboard.*` (both old and new assignee) |
| Create time entry | `tasks.timeEntries(taskId)`, `tasks.detail(taskId)`, `projects.timeSummary(projectId)`, `dashboard.*` |
| Start timer | `timer.active` |
| Stop timer | `timer.active`, then same as create time entry |

---

## 6. Optimistic UI Patterns

Optimistic updates provide instant feedback for common interactions.

### Timer Start/Stop (Critical Path)

```typescript
// hooks/useTimer.ts
export function useStartTimer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (taskId: string) => api.timer.start(taskId),
    
    onMutate: async (taskId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.timer.active });
      
      // Snapshot previous value
      const previousTimer = queryClient.getQueryData(queryKeys.timer.active);
      
      // Optimistically set new timer
      queryClient.setQueryData(queryKeys.timer.active, {
        task_id: taskId,
        started_at: new Date().toISOString(),
        // Task details will be filled in by refetch
      });
      
      return { previousTimer };
    },
    
    onError: (err, taskId, context) => {
      // Rollback on error
      queryClient.setQueryData(
        queryKeys.timer.active, 
        context?.previousTimer
      );
      toast.error('Failed to start timer');
    },
    
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.timer.active });
    },
  });
}

export function useStopTimer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => api.timer.stop(),
    
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.timer.active });
      const previousTimer = queryClient.getQueryData(queryKeys.timer.active);
      
      // Optimistically clear timer
      queryClient.setQueryData(queryKeys.timer.active, null);
      
      return { previousTimer };
    },
    
    onError: (err, _, context) => {
      queryClient.setQueryData(
        queryKeys.timer.active, 
        context?.previousTimer
      );
      toast.error('Failed to stop timer');
    },
    
    onSuccess: (timeEntry) => {
      // Invalidate related queries now that entry is created
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.tasks.timeEntries(timeEntry.task_id) 
      });
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.tasks.detail(timeEntry.task_id) 
      });
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.dashboard.tech 
      });
    },
  });
}
```

### Task Status Change

```typescript
export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      api.tasks.updateStatus(taskId, status),
    
    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ 
        queryKey: queryKeys.tasks.detail(taskId) 
      });
      
      const previousTask = queryClient.getQueryData<Task>(
        queryKeys.tasks.detail(taskId)
      );
      
      if (previousTask) {
        queryClient.setQueryData(queryKeys.tasks.detail(taskId), {
          ...previousTask,
          status,
        });
      }
      
      return { previousTask };
    },
    
    onError: (err, { taskId }, context) => {
      if (context?.previousTask) {
        queryClient.setQueryData(
          queryKeys.tasks.detail(taskId),
          context.previousTask
        );
      }
      toast.error('Failed to update status');
    },
    
    onSettled: (_, __, { taskId }) => {
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.tasks.detail(taskId) 
      });
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.tasks.lists() 
      });
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.dashboard.tech 
      });
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.dashboard.pm 
      });
    },
  });
}
```

### Requirement Checkbox Toggle

```typescript
export function useToggleRequirement() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ taskId, requirementId, completed }: ToggleRequirementInput) =>
      api.tasks.toggleRequirement(taskId, requirementId, completed),
    
    onMutate: async ({ taskId, requirementId, completed }) => {
      await queryClient.cancelQueries({ 
        queryKey: queryKeys.tasks.detail(taskId) 
      });
      
      const previousTask = queryClient.getQueryData<Task>(
        queryKeys.tasks.detail(taskId)
      );
      
      if (previousTask) {
        const updatedRequirements = previousTask.requirements.map((req) =>
          req.id === requirementId
            ? { ...req, completed, completed_at: completed ? new Date().toISOString() : null }
            : req
        );
        
        queryClient.setQueryData(queryKeys.tasks.detail(taskId), {
          ...previousTask,
          requirements: updatedRequirements,
        });
      }
      
      return { previousTask };
    },
    
    onError: (err, { taskId }, context) => {
      if (context?.previousTask) {
        queryClient.setQueryData(
          queryKeys.tasks.detail(taskId),
          context.previousTask
        );
      }
    },
    
    onSettled: (_, __, { taskId }) => {
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.tasks.detail(taskId) 
      });
    },
  });
}
```

### Optimistic Update Decision Matrix

| Action | Optimistic? | Rationale |
|--------|-------------|-----------|
| Timer start/stop | âœ… Yes | Must feel instant |
| Task status change | âœ… Yes | Frequent action, clear user intent |
| Requirement toggle | âœ… Yes | Checkbox should respond immediately |
| Priority change | âœ… Yes | Simple field update |
| Assignee change | âœ… Yes | Dropdown selection is clear intent |
| Task creation | âŒ No | Need server-generated ID, complex |
| Project creation | âŒ No | Complex with task generation |
| Bulk operations | âŒ No | Too complex to rollback |
| Delete operations | âŒ No | Destructive, show loading state |

---

## 7. Form State Handling

### React Hook Form Configuration

```typescript
// Standard form setup
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { taskSchema } from '@/lib/validations';

export function TaskForm({ task, onSubmit }) {
  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: task ? mapTaskToFormData(task) : defaultTaskValues,
  });
  
  // Reset form when task prop changes (editing different task)
  useEffect(() => {
    if (task) {
      form.reset(mapTaskToFormData(task));
    }
  }, [task?.id]);
  
  return (
    <Form {...form}>
      {/* form fields */}
    </Form>
  );
}
```

### Form State Patterns

| Pattern | Use Case |
|---------|----------|
| **Controlled modal form** | Quick Task Create, Time Entry Modal |
| **Inline editing** | Status dropdown, assignee picker, due date |
| **Multi-step wizard** | Project Creation Wizard |
| **Autosave** | Notes, rich text content (debounced) |

### Wizard State

For the Project Creation Wizard, use a dedicated context to hold step data:

```typescript
// contexts/ProjectWizardContext.tsx
interface WizardState {
  step: number;
  data: {
    recipe: Recipe | null;
    client: Client | null;
    site: Site | null;
    sitemap: Page[];
    teamAssignments: Record<string, string>; // function_id -> user_id
    projectName: string;
    billingType: 'hourly' | 'fixed';
  };
}

const ProjectWizardContext = createContext<WizardContextValue | null>(null);

export function ProjectWizardProvider({ children }) {
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  
  // Persist to sessionStorage for recovery on accidental navigation
  useEffect(() => {
    sessionStorage.setItem('project-wizard-draft', JSON.stringify(state));
  }, [state]);
  
  return (
    <ProjectWizardContext.Provider value={{ state, dispatch }}>
      {children}
    </ProjectWizardContext.Provider>
  );
}
```

### Inline Edit Pattern

For inline editing (status, assignee, etc.), use a local editing state that syncs on blur/selection:

```typescript
function InlineStatusSelect({ task }) {
  const { mutate: updateStatus, isPending } = useUpdateTaskStatus();
  
  const handleChange = (newStatus: TaskStatus) => {
    updateStatus({ taskId: task.id, status: newStatus });
  };
  
  return (
    <Select 
      value={task.status} 
      onValueChange={handleChange}
      disabled={isPending}
    >
      {/* options */}
    </Select>
  );
}
```

---

## 8. Global Client State

Minimal global client state using React Context.

### AppContext

```typescript
// contexts/AppContext.tsx
interface AppState {
  sidebarCollapsed: boolean;
  activeTimerTaskId: string | null; // Mirrors server, for quick access
  theme: 'light' | 'dark' | 'system';
}

interface AppContextValue {
  state: AppState;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveTimerTaskId: (taskId: string | null) => void;
  setTheme: (theme: AppState['theme']) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }) {
  const [state, setState] = useState<AppState>(() => ({
    sidebarCollapsed: localStorage.getItem('sidebar-collapsed') === 'true',
    activeTimerTaskId: null,
    theme: (localStorage.getItem('theme') as AppState['theme']) || 'system',
  }));
  
  // Sync sidebar preference to localStorage
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(state.sidebarCollapsed));
  }, [state.sidebarCollapsed]);
  
  // Sync with server timer state
  const { data: activeTimer } = useQuery({
    queryKey: queryKeys.timer.active,
    queryFn: api.timer.getActive,
    staleTime: 0,
    refetchInterval: 60 * 1000, // Check every minute
  });
  
  useEffect(() => {
    setState(prev => ({
      ...prev,
      activeTimerTaskId: activeTimer?.task_id || null,
    }));
  }, [activeTimer?.task_id]);
  
  const value: AppContextValue = {
    state,
    toggleSidebar: () => setState(prev => ({ 
      ...prev, 
      sidebarCollapsed: !prev.sidebarCollapsed 
    })),
    setSidebarCollapsed: (collapsed) => setState(prev => ({ 
      ...prev, 
      sidebarCollapsed: collapsed 
    })),
    setActiveTimerTaskId: (taskId) => setState(prev => ({ 
      ...prev, 
      activeTimerTaskId: taskId 
    })),
    setTheme: (theme) => setState(prev => ({ ...prev, theme })),
  };
  
  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
```

### What Stays Local (Not Global)

| State | Location | Reason |
|-------|----------|--------|
| Modal open/closed | Component | Only one component cares |
| Dropdown open | Component | UI-only, ephemeral |
| Form field values | React Hook Form | Managed by form library |
| Filter selections | URL params | Shareable, survives refresh |
| Sort order | URL params | Shareable |
| Current tab | URL params | Shareable |

---

## 9. Real-Time Updates

### Polling Strategy

Given the 30-60 second freshness requirement, we use window-focus refetching plus interval polling for critical data.

```typescript
// Dashboard queries - refetch every 60 seconds when focused
useQuery({
  queryKey: queryKeys.dashboard.tech,
  queryFn: api.dashboard.getTech,
  staleTime: 30 * 1000,
  refetchInterval: 60 * 1000,
  refetchIntervalInBackground: false, // Don't poll when tab not visible
});

// Active timer - check frequently
useQuery({
  queryKey: queryKeys.timer.active,
  queryFn: api.timer.getActive,
  staleTime: 0, // Always consider stale
  refetchInterval: 60 * 1000,
  refetchOnWindowFocus: true, // Critical: catch timer stopped elsewhere
});

// Notifications - moderate polling
useQuery({
  queryKey: queryKeys.user.notifications,
  queryFn: api.notifications.list,
  staleTime: 30 * 1000,
  refetchInterval: 60 * 1000,
});
```

### Client-Side Timer Display

The timer widget displays time elapsed, but the *ticking* is purely client-side (not a fetch every second):

```typescript
// components/TimerWidget.tsx
function TimerWidget() {
  const { data: activeTimer } = useQuery({
    queryKey: queryKeys.timer.active,
    queryFn: api.timer.getActive,
    staleTime: 0,
  });
  
  const [elapsed, setElapsed] = useState(0);
  
  // Calculate and update elapsed time every second (client-side only)
  useEffect(() => {
    if (!activeTimer?.started_at) {
      setElapsed(0);
      return;
    }
    
    const startTime = new Date(activeTimer.started_at).getTime();
    
    const updateElapsed = () => {
      setElapsed(Date.now() - startTime);
    };
    
    updateElapsed(); // Immediate
    const interval = setInterval(updateElapsed, 1000);
    
    return () => clearInterval(interval);
  }, [activeTimer?.started_at]);
  
  // ... render with `elapsed` milliseconds
}
```

### Refetch on Key Events

Certain user actions should trigger immediate refetches:

```typescript
// After stopping timer
onSuccess: () => {
  // Immediate refetch of affected data
  queryClient.refetchQueries({ queryKey: queryKeys.dashboard.tech });
  queryClient.refetchQueries({ queryKey: queryKeys.tasks.lists() });
};

// On window focus (handled by React Query defaults)
// On route navigation - refetch stale queries for new page
```

---

## 10. Multi-Tab Considerations

### MVP Approach (Handled by Defaults)

React Query's `refetchOnWindowFocus: true` provides basic multi-tab consistency:

- When user switches to a tab, stale queries refetch
- Timer state syncs within ~60 seconds or on tab focus
- Acceptable for 3-4 users

### Future Enhancement: BroadcastChannel

For better multi-tab sync without server changes, we can use the BroadcastChannel API:

```typescript
// lib/tabSync.ts (Future enhancement)
const channel = new BroadcastChannel('indelible-sync');

// Broadcast cache invalidations to other tabs
export function broadcastInvalidation(queryKey: QueryKey) {
  channel.postMessage({ type: 'invalidate', queryKey });
}

// Listen for invalidations from other tabs
channel.onmessage = (event) => {
  if (event.data.type === 'invalidate') {
    queryClient.invalidateQueries({ queryKey: event.data.queryKey });
  }
};
```

This would be wrapped into mutation hooks:

```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() });
  broadcastInvalidation(queryKeys.tasks.lists()); // Notify other tabs
};
```

**Deferred to post-MVP** unless implementation proves trivial.

---

## Summary: State Flow Diagram

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                         INDELIBLE STATE ARCHITECTURE                â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                     â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚
â”‚  â”‚                    SERVER (PostgreSQL)                       â”‚   â”‚
â”‚  â”‚  Clients, Projects, Tasks, Time Entries, Users, etc.        â”‚   â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚
â”‚                              â”‚                                      â”‚
â”‚                              â”‚ REST API                             â”‚
â”‚                              â–¼                                      â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚
â”‚  â”‚                    REACT QUERY CACHE                         â”‚   â”‚
â”‚  â”‚                                                              â”‚   â”‚
â”‚  â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”       â”‚   â”‚
â”‚  â”‚  â”‚ clients  â”‚ â”‚ projects â”‚ â”‚  tasks   â”‚ â”‚  timer   â”‚       â”‚   â”‚
â”‚  â”‚  â”‚  list    â”‚ â”‚  list    â”‚ â”‚  list    â”‚ â”‚  active  â”‚       â”‚   â”‚
â”‚  â”‚  â”‚  detail  â”‚ â”‚  detail  â”‚ â”‚  detail  â”‚ â”‚          â”‚       â”‚   â”‚
â”‚  â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜       â”‚   â”‚
â”‚  â”‚                                                              â”‚   â”‚
â”‚  â”‚  â€¢ Stale-while-revalidate                                   â”‚   â”‚
â”‚  â”‚  â€¢ Optimistic mutations with rollback                       â”‚   â”‚
â”‚  â”‚  â€¢ Automatic background refetch                             â”‚   â”‚
â”‚  â”‚  â€¢ 30-60s polling for dashboards/timer                      â”‚   â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚
â”‚                              â”‚                                      â”‚
â”‚         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                â”‚
â”‚         â”‚                    â”‚                    â”‚                â”‚
â”‚         â–¼                    â–¼                    â–¼                â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”      â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”           â”‚
â”‚  â”‚   GLOBAL   â”‚      â”‚    URL     â”‚      â”‚   LOCAL    â”‚           â”‚
â”‚  â”‚  CONTEXT   â”‚      â”‚   STATE    â”‚      â”‚   STATE    â”‚           â”‚
â”‚  â”‚            â”‚      â”‚            â”‚      â”‚            â”‚           â”‚
â”‚  â”‚ â€¢ Sidebar  â”‚      â”‚ â€¢ Filters  â”‚      â”‚ â€¢ Dropdownsâ”‚           â”‚
â”‚  â”‚ â€¢ Theme    â”‚      â”‚ â€¢ Tab      â”‚      â”‚ â€¢ Hovers   â”‚           â”‚
â”‚  â”‚ â€¢ Timer ID â”‚      â”‚ â€¢ Cursor   â”‚      â”‚ â€¢ Form WIP â”‚           â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜           â”‚
â”‚                                                                     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## Related Documents

- `indelible-api-endpoint-inventory.md` â€” API specification
- `indelible-data-model-refinement.md` â€” Database schema
- `indelible-component-library.md` â€” UI components
- `indelible-user-flows.md` â€” User journeys
- `indelible-wireframes-quest-detail.md` â€” Quest detail wireframes