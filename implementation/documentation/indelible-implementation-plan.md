# Indelible App: Implementation Plan
## Build Guide for Claude Code

**Version:** 1.0  
**Date:** December 2024  
**Target Launch:** January/February 2025

---

## Project Overview

Indelible is a custom project management application for a web development agency, replacing a Notion-based system. It manages clients ("Patrons"), websites ("Sites"), projects ("Pacts"), tasks ("Quests"), time tracking, SOPs, and recipes (project templates).

### Key Characteristics

- **Users:** 3-4 now, scaling to ~20
- **Roles:** Tech (developer), PM (project manager), Admin
- **Design philosophy:** Neurodivergent-optimized (reduce cognitive load, clear prioritization, minimal friction)
- **Fantasy terminology:** Patrons (clients), Pacts (projects), Quests (tasks), Rituals (recipes), Grimoire (SOPs)

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18+ with TypeScript |
| **Framework** | Next.js 14+ (App Router) |
| **Styling** | Tailwind CSS (Stitch templates provided) |
| **Components** | Shadcn/ui (customize to match Stitch) |
| **State** | TanStack Query (React Query v5) for server state |
| **Forms** | React Hook Form + Zod validation |
| **Rich Text** | TipTap (ProseMirror-based) |
| **Drag & Drop** | dnd-kit |
| **Backend** | Next.js API Routes |
| **Database** | PostgreSQL 15+ with pgvector extension |
| **ORM** | Prisma |
| **Auth** | JWT (access + refresh tokens) with HTTP-only cookies |
| **Sessions** | PostgreSQL (via `connect-pg-simple`) |
| **Hosting** | AWS (EC2 + RDS PostgreSQL) |

### Why These Choices

- **Next.js API Routes** â€” Single deployment, simpler infrastructure for MVP
- **Prisma** â€” Excellent DX, auto-generated types, mature ecosystem
- **Shadcn/ui** â€” Copy-paste components you own, built on Radix, Tailwind-native
- **PostgreSQL sessions** â€” No external Redis cost, sufficient for 20 users
- **pgvector** â€” Future-proofs for semantic search on tasks, SOPs, notes

---

## Planning Documents Reference

All specifications are in these documents (in the project):

| Document | Contents |
|----------|----------|
| `indelible-app-architecture.md` | Entity definitions, relationships, business rules |
| `indelible-data-model-refinement.md` | Complete PostgreSQL schema, indexes, constraints |
| `indelible-api-endpoint-inventory.md` | All ~138 API endpoints with request/response shapes |
| `indelible-auth-design.md` | Authentication flows, JWT strategy, role enforcement |
| `indelible-state-management-plan.md` | React Query setup, caching, optimistic updates |
| `indelible-navigation-sitemap.md` | Route structure, sidebar navigation, breadcrumbs |
| `indelible-screen-inventory.md` | All 37 screens with data requirements and states |
| `indelible-user-flows.md` | Step-by-step workflows for critical features |
| `indelible-wireframes-*.md` | Wireframes for all major interfaces |
| `indelible-component-library.md` | Reusable UI components catalog |
| `indelible-testing-strategy.md` | Test approach, E2E scenarios, coverage targets |
| `indelible-deployment-devops.md` | Hosting, CI/CD, monitoring setup |
| `indelible-migration-runbook.md` | Notion data migration approach |

---

## Build Phases

### Phase 1: Project Foundation
**Goal:** Runnable app skeleton with auth

```
Duration: 2-3 days
Outcome: Can login, see role-based dashboard shell, logout
```

#### 1.1 Project Setup
- [ ] Initialize Next.js project with TypeScript
- [ ] Configure Tailwind CSS
- [ ] Set up project structure:
```
/app                    # Next.js App Router pages
  /api                  # API routes (or separate Express server)
  /(auth)               # Auth pages (login, etc.)
  /(app)                # Authenticated app shell
    /overlook           # Dashboard
    /foundry            # Patrons, Sites, Domains
    /sanctum            # Pacts, Quests
    /chronicles         # Time tracking
    /grimoire           # SOPs, Rituals
    /guild              # Team, Settings
/components             # React components
  /ui                   # Generic UI (buttons, inputs, etc.)
  /domain               # Domain-specific (TaskCard, TimerWidget)
  /layout               # Shell, Sidebar, Header
/lib                    # Utilities, hooks, API client
/prisma                 # Database schema and migrations
```
- [ ] Set up environment variables structure
- [ ] Configure ESLint + Prettier

#### 1.2 Database Setup
- [ ] Create Prisma schema from `indelible-data-model-refinement.md`
- [ ] Set up PostgreSQL connection (AWS RDS or local for dev)
- [ ] Enable pgvector extension: `CREATE EXTENSION vector;`
- [ ] Generate initial migration
- [ ] Create seed script for:
  - Default functions
  - Default hosting/maintenance plans
  - Test user accounts (1 per role)

#### 1.3 Authentication
- [ ] Implement auth endpoints per `indelible-auth-design.md`:
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `POST /api/auth/refresh`
  - `GET /api/auth/me`
- [ ] Set up JWT with HTTP-only cookies
- [ ] Create auth middleware
- [ ] Implement role-based route guards
- [ ] Build login page

#### 1.4 App Shell
- [ ] Create authenticated layout wrapper
- [ ] Build sidebar navigation (per `indelible-wireframes-global-shell.md`)
  - Role-based menu items
  - Collapsed/expanded states
  - Active state indicators
- [ ] Build header bar
  - Global search placeholder
  - Notification bell placeholder
  - User menu with logout
  - Timer widget placeholder
- [ ] Create placeholder dashboard pages for each role

---

### Phase 2: Core Entities (CRUD)
**Goal:** Manage Patrons, Sites, Domains without projects/tasks

```
Duration: 3-4 days
Outcome: Full CRUD for foundation entities
```

#### 2.1 API Layer Setup
- [ ] Set up React Query client (`indelible-state-management-plan.md`)
- [ ] Create API client with auth interceptors
- [ ] Define query key conventions
- [ ] Set up error handling patterns

#### 2.2 Patrons (Clients)
- [ ] API endpoints:
  - `GET /api/clients` (list with filters)
  - `GET /api/clients/:id` (detail)
  - `POST /api/clients` (create)
  - `PATCH /api/clients/:id` (update)
  - `DELETE /api/clients/:id` (soft delete)
- [ ] List page with filtering/search
- [ ] Detail page with tabs (Overview, Sites, Pacts, Billing)
- [ ] Create/Edit modal
- [ ] Client type handling (direct, agency_partner, sub_client)

#### 2.3 Sites
- [ ] API endpoints (same pattern as Patrons)
- [ ] List page
- [ ] Detail page with tabs (Overview, Domains, Pacts, Quests)
- [ ] Create/Edit modal with Patron selector
- [ ] Hosting plan and Maintenance plan selectors

#### 2.4 Domains
- [ ] API endpoints
- [ ] List page (simple table)
- [ ] Create/Edit modal
- [ ] Link to Sites

#### 2.5 Reference Data Management
- [ ] Hosting Plans CRUD (Admin only)
- [ ] Maintenance Plans CRUD (Admin only)
- [ ] Functions CRUD (Admin only)
- [ ] Tools CRUD (Admin only)

---

### Phase 3: Projects & Tasks Core
**Goal:** Create and manage Pacts and Quests

```
Duration: 4-5 days
Outcome: Project creation, task management, status workflows
```

#### 3.1 Pacts (Projects)
- [ ] API endpoints per `indelible-api-endpoint-inventory.md`
- [ ] List page with status filtering
- [ ] Detail page with tabs:
  - Overview (status, dates, team, budget)
  - Quests (task list with grouping)
  - Workload (phase-based view)
  - Time (time entries summary)
  - Notes
- [ ] Create Pact modal (simple, no wizard yet)
- [ ] Status transitions with validation
- [ ] Team assignment

#### 3.2 Quests (Tasks)
- [ ] API endpoints
- [ ] Task list with filtering (status, assignee, project, priority)
- [ ] Task detail view (full page and peek drawer)
- [ ] Create/Edit task modal
- [ ] Status workflow per `indelible-user-flows.md`:
  - not_started â†’ in_progress â†’ review â†’ done
  - blocked handling
  - abandoned option
- [ ] Energy estimation fields (energy_impact, mystery_factor)
- [ ] Task assignment
- [ ] Blocking/blocked-by relationships

#### 3.3 Task Visibility Rules
- [ ] Implement project status gating:
  - Quote/Queue projects: tasks hidden from assignees
  - Ready/In Progress: tasks visible
  - Suspended: tasks hidden
- [ ] Dashboard query respects visibility

---

### Phase 4: Time Tracking
**Goal:** Timer and manual time entry

```
Duration: 2-3 days
Outcome: Working time tracking with active timer
```

#### 4.1 Timer Widget
- [ ] Global timer state (React Context)
- [ ] Timer widget in header
- [ ] Start timer from task
- [ ] Timer persists across navigation
- [ ] Stop timer â†’ create time entry flow

#### 4.2 Time Entries
- [ ] API endpoints
- [ ] Manual time entry modal
- [ ] Time entry list on task detail
- [ ] Time entry list on project detail
- [ ] Edit/delete time entries
- [ ] Daily/weekly time view (Chronicles)

#### 4.3 Time Validation
- [ ] Require task association
- [ ] Billable flag handling
- [ ] Duration validation

---

### Phase 5: Dashboards
**Goal:** Role-specific home screens

```
Duration: 2-3 days
Outcome: Functional Overlooks for each role
```

#### 5.1 Tech Overlook
- [ ] My Quests section (Ready, grouped by priority)
- [ ] Blocked/Upcoming Quests
- [ ] Active Timer Widget
- [ ] Missing Time Entries alert
- [ ] Recent Time Entries

#### 5.2 PM Overlook
- [ ] Focus Quests (priority subset)
- [ ] Awaiting Review section
- [ ] Unassigned Quests
- [ ] My Pacts with health indicators
- [ ] Retainer Alerts
- [ ] Recent Items sidebar

#### 5.3 Admin Overlook
- [ ] All PM features
- [ ] All Active Pacts view
- [ ] Team Utilization (placeholder)
- [ ] System Alerts

---

### Phase 6: Recipe Wizard
**Goal:** Project creation from templates

```
Duration: 3-4 days
Outcome: Full wizard flow generating projects with tasks
```

#### 6.1 Rituals (Recipes) Management
- [ ] Recipe CRUD (API + UI)
- [ ] Recipe detail showing phases and task templates
- [ ] Create/Edit recipe with phase structure

#### 6.2 Recipe Wizard
Per `indelible-user-flows.md` Flow 1:
- [ ] Step 1: Select Ritual
- [ ] Step 2: Select Patron & Site
- [ ] Step 3: Sitemap input (for variable tasks)
- [ ] Step 4: Team assignment (function â†’ user mapping)
- [ ] Step 5: Review & configure
- [ ] Step 6: Generate project + tasks
- [ ] Wizard state management
- [ ] Validation between steps

#### 6.3 Task Generation
- [ ] Generate tasks from recipe template
- [ ] Variable task generation from sitemap
- [ ] Auto-assign based on function mapping
- [ ] Milestone creation

---

### Phase 7: SOPs & Rich Text
**Goal:** SOP management with TipTap editor

```
Duration: 2-3 days
Outcome: Viewable and editable SOPs
```

#### 7.1 TipTap Integration
- [ ] Set up TipTap editor component
- [ ] Configure extensions (headings, lists, links, images)
- [ ] Read-only mode for viewing
- [ ] Edit mode for PM/Admin

#### 7.2 Grimoire (SOPs)
- [ ] SOP list page
- [ ] SOP detail view (rendered content)
- [ ] SOP edit page (TipTap editor)
- [ ] Link SOPs to Functions
- [ ] Link SOPs to Tasks (reference from task detail)

---

### Phase 8: Notifications & Polish
**Goal:** Notification system and UX refinements

```
Duration: 2-3 days
Outcome: Working notifications, polished interactions
```

#### 8.1 Notifications
- [ ] Notification model and API
- [ ] Notification bell with unread count
- [ ] Notification dropdown/panel
- [ ] Mark as read
- [ ] Notification triggers:
  - Project activated (tasks visible)
  - Task assigned
  - Task returned from review
  - Retainer threshold

#### 8.2 Polish
- [ ] Loading states (skeletons)
- [ ] Empty states
- [ ] Error states
- [ ] Toast notifications for actions
- [ ] Keyboard shortcuts (if time permits)
- [ ] Responsive adjustments

---

### Phase 9: Reports & Settings
**Goal:** Reporting views and admin settings

```
Duration: 2 days
Outcome: Basic reports, user management
```

#### 9.1 Reports
- [ ] Time by project report
- [ ] Time by team member report
- [ ] Retainer usage report
- [ ] Export to CSV

#### 9.2 Settings
- [ ] User profile editing
- [ ] User preferences (theme, notifications)
- [ ] User management (Admin)
- [ ] Invite user flow

---

### Phase 10: Testing & Deployment
**Goal:** Production-ready application

```
Duration: 2-3 days
Outcome: Tested, deployed application
```

#### 10.1 Testing
- [ ] Unit tests for business logic (per `indelible-testing-strategy.md`)
- [ ] Integration tests for critical API endpoints
- [ ] E2E tests for critical flows:
  - Auth flow
  - Project creation wizard
  - Task lifecycle
  - Time tracking
- [ ] Manual testing checklist

#### 10.2 Data Migration
- [ ] Generate seed SQL from Notion CSVs
- [ ] Run migration on staging
- [ ] Validate migrated data
- [ ] Document manual post-migration tasks (Recipes, SOPs)

#### 10.3 Deployment
- [ ] Set up staging environment
- [ ] Set up production environment
- [ ] Configure CI/CD (per `indelible-deployment-devops.md`)
- [ ] Set up monitoring (Sentry, uptime)
- [ ] SSL and domain configuration
- [ ] Go-live

---

## Build Order Summary

| Phase | Focus | Est. Days |
|-------|-------|-----------|
| 1 | Foundation + Auth | 2-3 |
| 2 | Patrons, Sites, Domains | 3-4 |
| 3 | Pacts + Quests | 4-5 |
| 4 | Time Tracking | 2-3 |
| 5 | Dashboards | 2-3 |
| 6 | Recipe Wizard | 3-4 |
| 7 | SOPs + TipTap | 2-3 |
| 8 | Notifications + Polish | 2-3 |
| 9 | Reports + Settings | 2 |
| 10 | Testing + Deployment | 2-3 |
| **Total** | | **25-33 days** |

---

## Key Implementation Notes

### Fantasy Terminology Mapping

Use these names in UI, but standard names in code:

| UI Term | Code Term | Database Table |
|---------|-----------|----------------|
| Patron | Client | `clients` |
| Pact | Project | `projects` |
| Quest | Task | `tasks` |
| Ritual | Recipe | `recipes` |
| Grimoire | SOP | `sops` |
| Overlook | Dashboard | â€” |
| Foundry | (Patrons/Sites section) | â€” |
| Sanctum | (Projects/Tasks section) | â€” |
| Chronicles | (Time tracking section) | â€” |
| Guild | (Team/Settings section) | â€” |

### Role-Based Visibility

| Feature | Tech | PM | Admin |
|---------|------|-----|-------|
| View own tasks | âœ… | âœ… | âœ… |
| View all tasks | âŒ | âœ… | âœ… |
| Create projects | âŒ | âœ… | âœ… |
| Assign tasks | âŒ | âœ… | âœ… |
| View billing rates | âŒ | âœ… | âœ… |
| Manage users | âŒ | âŒ | âœ… |
| Manage reference data | âŒ | âŒ | âœ… |

### Task Visibility Logic

```typescript
// Task is visible to assignee if:
function isTaskVisibleToAssignee(task, project) {
  // Ad-hoc tasks (no project) are always visible
  if (!task.project_id) return true;
  
  // Project must be in visible status
  const visibleStatuses = ['ready', 'in_progress', 'review', 'done'];
  return visibleStatuses.includes(project.status);
}
```

### Optimistic Updates

Apply optimistic updates for these actions:
- Timer start/stop
- Task status changes
- Checkbox/requirement toggles
- Priority changes
- Assignee changes

Do NOT use optimistic updates for:
- Create operations (need server ID)
- Delete operations (too risky)
- Complex operations (wizard, bulk)

### Stitch Templates

HTML/CSS templates from Google Stitch will be provided for:
- Global shell layout
- Card components
- Form elements
- Color palette and spacing

Extract Tailwind classes and component patterns from these templates.

---

## Getting Started

1. **Read these docs first:**
   - `indelible-app-architecture.md` (understand the domain)
   - `indelible-data-model-refinement.md` (database schema)
   - `indelible-auth-design.md` (auth implementation)

2. **Start with Phase 1** â€” get a working login and shell

3. **Reference wireframes** as you build each section:
   - `indelible-wireframes-global-shell.md`
   - `indelible-wireframes-dashboards.md`
   - `indelible-wireframes-list-views.md`
   - etc.

4. **Check API inventory** for endpoint specs:
   - `indelible-api-endpoint-inventory.md`

5. **Follow user flows** for complex features:
   - `indelible-user-flows.md`

---

---

## Future Enhancements (Post-MVP)

These are deferred but the architecture supports them:

1. **Semantic Search** â€” pgvector is installed; add embeddings to tasks, SOPs, notes for similarity search
2. **Mobile App** â€” Extract API routes to standalone Express if needed
3. **Real-time Updates** â€” Add WebSockets or Server-Sent Events for multi-user sync
4. **QuickBooks Integration** â€” Client billing sync (fields already in schema)
