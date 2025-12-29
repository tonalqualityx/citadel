# Indelible Feature Audit

This document provides a comprehensive inventory of all planned features from the implementation documentation, organized by phase. Each feature has been evaluated against the current codebase.

**Audit Date:** December 28, 2025

**Status Key:**
- **Complete**: Feature fully implemented and functional
- **Partial**: Feature exists but missing some functionality
- **Missing**: Feature not yet implemented

---

## Executive Summary

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Foundation | Complete | 95% |
| Phase 2: Core Entities | Complete | 100% |
| Phase 3: Projects & Tasks | Complete | 95% |
| Phase 4: Time Tracking | Complete | 90% |
| Phase 5: Dashboards | Partial | 85% |
| Phase 6: Recipe Wizard | Partial | 80% |
| Phase 7: SOPs & Rich Text | Partial | 85% |
| Phase 8: Notifications & Polish | Partial | 60% |
| Phase 9: Reports & Data | Partial | 40% |
| Phase 10: Testing & Deployment | Partial | 50% |

---

## Phase 1: Foundation

### 1.1 Authentication & Authorization
| Feature | Description | Status |
|---------|-------------|--------|
| JWT Authentication | Access tokens (15min) + refresh tokens (7 days) | **Complete** |
| Role-Based Access | Admin, PM, Tech roles with different permissions | **Complete** |
| Login/Logout | Session management with secure cookies | **Complete** |
| Protected Routes | Middleware redirecting unauthenticated users | **Complete** |

### 1.2 Database & Schema
| Feature | Description | Status |
|---------|-------------|--------|
| PostgreSQL + Prisma | Full schema with all entities | **Complete** |
| Soft Deletes | `is_deleted` flag on all major entities | **Complete** |
| Audit Fields | `created_at`, `updated_at` on all tables | **Complete** |
| Seed Data | Development data for testing | **Complete** |

### 1.3 Core UI Shell
| Feature | Description | Status |
|---------|-------------|--------|
| Left Sidebar Navigation | Collapsible with icons + labels | **Complete** |
| Header Bar | User avatar, search, notifications | **Complete** |
| Theme System | Light, Dim, Dark modes via CSS variables | **Complete** |
| Naming Convention Toggle | Awesome (Patrons/Quests) vs Standard (Clients/Tasks) | **Complete** |
| Toast Notifications | Success/error/info messages | **Partial** - In-app notifications exist; no pop-up toast library |

---

## Phase 2: Core Entities (Patrons, Sites, Domains)

### 2.1 Clients (Patrons)
| Feature | Description | Status |
|---------|-------------|--------|
| Client List View | Searchable, filterable table with status badges | **Complete** |
| Client Detail View | Overview with sites, domains, projects | **Complete** |
| Client CRUD | Create, read, update, soft-delete | **Complete** |
| Client Types | agency, direct, personal | **Complete** |
| Client Status | active, inactive, prospect | **Complete** |
| Sub-Clients | Agency → sub-client hierarchy | **Complete** |
| Retainer Hours | Monthly retainer tracking per client | **Complete** |
| Hourly Rate | Default billing rate | **Complete** |

### 2.2 Sites (Runes)
| Feature | Description | Status |
|---------|-------------|--------|
| Site List View | Grouped by client | **Complete** |
| Site Detail View | Domains, hosting info, related projects | **Complete** |
| Site CRUD | Create, read, update, soft-delete | **Complete** |
| Hosting Plans | Link to hosting plan with rate | **Complete** |
| Maintenance Plans | Link to maintenance plan with rate | **Complete** |
| Platform Field | WordPress, Shopify, custom, etc. | **Complete** |

### 2.3 Domains
| Feature | Description | Status |
|---------|-------------|--------|
| Domain List View | All domains with expiry dates | **Complete** |
| Domain CRUD | Create, read, update, soft-delete | **Complete** |
| Expiry Tracking | `expires_at` field with alerts | **Complete** |
| Primary Domain Flag | `is_primary` boolean | **Complete** |
| Registrar Field | Where domain is registered | **Complete** |

### 2.4 Service Plans
| Feature | Description | Status |
|---------|-------------|--------|
| Hosting Plans | Name, rate, description | **Complete** |
| Maintenance Plans | Name, rate, description | **Complete** |
| Plan Management UI | Admin-only CRUD | **Complete** |

---

## Phase 3: Projects & Tasks (Pacts & Quests)

### 3.1 Projects (Pacts)
| Feature | Description | Status |
|---------|-------------|--------|
| Project List View | Filterable by status, client, type | **Complete** |
| Project Detail View | Overview, tasks, team, timeline | **Complete** |
| Project CRUD | Create, read, update, soft-delete | **Complete** |
| Project Status | draft, quote, ready, in_progress, review, done, archived | **Complete** |
| Project Types | website, maintenance, support, consulting, internal | **Complete** |
| Billing Types | fixed, hourly, retainer, none | **Complete** |
| Budget Workflow | Computed from tasks → locked after approval | **Complete** |
| Team Assignments | Users assigned to projects with function roles | **Complete** |
| Project Phases | Custom phases per project | **Complete** |
| Milestones | Target dates for project checkpoints | **Partial** - Schema exists, no UI |

### 3.2 Tasks (Quests)
| Feature | Description | Status |
|---------|-------------|--------|
| Task List View | Inline editing, drag-drop reorder | **Complete** |
| Task Detail/Peek | Slide-out drawer with full details | **Complete** |
| Task CRUD | Create, read, update, soft-delete | **Complete** |
| Task Status | not_started, in_progress, review, done, blocked, abandoned | **Complete** |
| Status Transitions | Valid state machine transitions | **Partial** - Transitions work, validation rules not enforced |
| Priority Levels | 1-5 scale with visual indicators | **Complete** |
| Energy Estimate | 1-8 scale for time estimation | **Complete** |
| Mystery Factor | none, average, significant, no_idea | **Complete** |
| Battery Impact | average_drain, high_drain, energizing | **Complete** |
| Estimated Minutes | Calculated from energy + mystery | **Complete** |
| Task Dependencies | blocked_by / blocking relationships | **Complete** |
| Task Requirements | Checklist items with completion tracking | **Complete** |
| Quality Gate | Review requirements (PM/Admin only) | **Complete** |
| Due Dates | Optional due date per task | **Complete** |
| Ad-hoc Tasks | Tasks without a project | **Complete** |
| Phase Assignment | Tasks belong to project phases | **Complete** |
| SOP Linking | Link task to an SOP template | **Complete** |
| Function Assignment | Development, Design, QA, etc. | **Complete** |

### 3.3 Computed Project Metrics
| Feature | Description | Status |
|---------|-------------|--------|
| Estimated Hours Range | Min/max from task energies | **Complete** |
| Time Spent | Sum of time entries | **Complete** |
| Task Count | Total and completed | **Complete** |
| Progress Percent | Based on completed energy | **Complete** |

---

## Phase 4: Time Tracking

### 4.1 Time Entry Management
| Feature | Description | Status |
|---------|-------------|--------|
| Quick Timer | Start/stop from header or task | **Complete** |
| Manual Entry | Add time entries after the fact | **Complete** |
| Time Entry CRUD | Create, read, update, delete | **Complete** |
| Duration Display | Minutes stored, displayed as hours:minutes | **Complete** |
| Description Field | Notes about work performed | **Complete** |
| Billable Flag | Mark entries as billable/non-billable | **Complete** |

### 4.2 Active Timer
| Feature | Description | Status |
|---------|-------------|--------|
| Timer Widget | Persistent in header showing elapsed time | **Complete** |
| Task Association | Timer linked to specific task | **Complete** |
| Auto-Save | Periodic saves to prevent data loss | **Partial** - Saved on start; recovered via database flag |
| Timer Controls | Start, pause, stop, discard | **Partial** - No pause/resume; only start, stop, discard |

### 4.3 Time Views
| Feature | Description | Status |
|---------|-------------|--------|
| Timesheet View | Daily/weekly time log | **Complete** |
| Time by Project | Aggregated time per project | **Complete** |
| Time by Client | Aggregated time per client | **Complete** |

---

## Phase 5: Dashboards

### 5.1 Role-Based Dashboards
| Feature | Description | Status |
|---------|-------------|--------|
| Admin Dashboard | High-level metrics, system health | **Complete** |
| PM Dashboard | Project overview, team workload | **Complete** |
| Tech Dashboard | Personal tasks, active timer, daily plan | **Complete** |

### 5.2 Dashboard Widgets
| Feature | Description | Status |
|---------|-------------|--------|
| My Tasks Widget | Tasks assigned to current user | **Complete** |
| Recent Activity | Timeline of recent changes | **Complete** |
| Projects Summary | Active projects with progress | **Complete** |
| Upcoming Deadlines | Tasks/milestones due soon | **Partial** - Task due dates only; no milestone tracking |
| Time Summary | Hours logged today/week | **Complete** |
| Battery Status | Cognitive load indicator | **Partial** - Data available; not displayed in dashboard |

---

## Phase 6: Recipe Wizard

### 6.1 Recipe Templates
| Feature | Description | Status |
|---------|-------------|--------|
| Recipe CRUD | Create, read, update, delete templates | **Complete** |
| Recipe Categories | website, maintenance, audit, etc. | **Partial** - Only `default_type` exists |
| Task Templates | Pre-defined tasks with estimates | **Complete** |
| Phase Templates | Pre-defined project phases | **Complete** |
| Variable Substitution | {{client_name}}, {{site_name}}, etc. | **Partial** - Only `{page}` works |

### 6.2 Project Creation Wizard
| Feature | Description | Status |
|---------|-------------|--------|
| Step 1: Select Recipe | Choose template or start blank | **Complete** |
| Step 2: Select Client/Site | Pick existing or create new | **Complete** |
| Step 3: Configure Project | Name, dates, billing type | **Partial** - Name/dates in review step; no billing type override |
| Step 4: Customize Tasks | Modify generated tasks | **Partial** - Can select/deselect variable tasks only |
| Step 5: Review & Create | Final confirmation | **Complete** |
| Wizard State Management | Progress through steps, back/forward | **Complete** |

---

## Phase 7: SOPs & Rich Text

### 7.1 SOP Management
| Feature | Description | Status |
|---------|-------------|--------|
| SOP List View | Searchable, filterable by function | **Complete** |
| SOP Detail View | Full content with version history | **Partial** - Content shown; no version history |
| SOP CRUD | Create, read, update, soft-delete | **Complete** |
| SOP Versions | Track changes over time | **Missing** |
| Estimated Minutes | Time estimate for SOP completion | **Complete** |
| Function Assignment | Which role uses this SOP | **Complete** |

### 7.2 Rich Text Editor
| Feature | Description | Status |
|---------|-------------|--------|
| BlockNote Integration | Rich text editing for descriptions | **Complete** |
| Formatting | Bold, italic, headings, lists | **Complete** |
| Code Blocks | Syntax highlighted code snippets | **Complete** |
| Links | URL insertion and display | **Complete** |
| Images | Image upload and embedding | **Complete** |
| Tables | Basic table support | **Complete** |

### 7.3 File Attachments
| Feature | Description | Status |
|---------|-------------|--------|
| File Upload API | Upload to /public/uploads | **Complete** |
| Image Validation | Type and size validation | **Complete** |
| Attachment Display | Show attached files on entities | **Partial** - Images embed in content; no file list UI |

---

## Phase 8: Notifications & Polish

### 8.1 Notification System
| Feature | Description | Status |
|---------|-------------|--------|
| Notification Model | In-app notifications with types | **Complete** |
| Notification Types | assignment, mention, status_change, etc. | **Complete** |
| Notification Bell | Badge count in header | **Complete** |
| Notification Panel | Dropdown list of notifications | **Complete** |
| Mark as Read | Individual and bulk marking | **Complete** |
| Notification Bundling | Group similar notifications | **Complete** |
| User Preferences | Toggle notification types | **Partial** - Only bundling toggle; no per-type toggles |

### 8.2 Activity Feed
| Feature | Description | Status |
|---------|-------------|--------|
| Activity Log Model | Track all entity changes | **Missing** |
| Entity History | View changes to a specific entity | **Missing** |
| User Activity | View all actions by a user | **Missing** |

### 8.3 UI Polish
| Feature | Description | Status |
|---------|-------------|--------|
| Loading States | Skeletons and spinners | **Partial** - Components exist; inconsistent usage |
| Error Boundaries | Graceful error handling | **Partial** - API errors handled; no UI error boundaries |
| Empty States | Helpful messages when no data | **Complete** |
| Keyboard Shortcuts | Common actions via keyboard | **Partial** - Command palette (Cmd+K) only |
| Responsive Design | Mobile-friendly layouts | **Partial** - Basic responsive; not comprehensive |

---

## Phase 9: Reports & Data

### 9.1 Reporting
| Feature | Description | Status |
|---------|-------------|--------|
| Time Reports | Hours by project/client/user | **Complete** |
| Project Reports | Status, budget, timeline | **Partial** - Health calculations exist; no UI |
| Client Reports | Revenue, hours, project history | **Partial** - Retainer tracking only |
| Export to CSV | Download report data | **Complete** |

### 9.2 Data Management
| Feature | Description | Status |
|---------|-------------|--------|
| Bulk Operations | Multi-select and batch actions | **Missing** |
| Data Import | CSV import for clients/sites | **Missing** |
| Data Export | Full data export | **Partial** - Time report export only |
| Archive Management | View and restore archived items | **Partial** - Soft delete exists; no UI |

---

## Phase 10: Testing & Deployment

### 10.1 Testing
| Feature | Description | Status |
|---------|-------------|--------|
| Unit Tests | Component and utility tests | **Missing** - Infrastructure exists; no tests |
| Integration Tests | API endpoint tests | **Missing** |
| E2E Tests | Critical user flows | **Partial** - Auth and search tested only |
| Test Coverage | Minimum coverage thresholds | **Missing** |

### 10.2 Deployment
| Feature | Description | Status |
|---------|-------------|--------|
| Production Build | Optimized Next.js build | **Complete** |
| Environment Config | Staging and production envs | **Complete** |
| Database Migrations | Safe migration workflow | **Partial** - Schema complete; no migration history |
| CI/CD Pipeline | Automated testing and deploy | **Complete** |

---

## Priority Gap List

### High Priority (Core Functionality Gaps)

1. **Activity Feed / Audit Logging** (Phase 8)
   - No entity change tracking
   - No user activity history
   - Impact: Cannot audit changes or track who did what

2. **Toast Notifications** (Phase 1)
   - No pop-up feedback for user actions
   - Impact: Users don't get immediate confirmation of actions

3. **Battery Status on Dashboard** (Phase 5)
   - Data exists but not displayed
   - Impact: Neurodivergent-friendly feature not visible

4. **Milestone UI** (Phase 3)
   - Schema exists, no management UI
   - Impact: Cannot create/edit milestones visually

### Medium Priority (Enhanced Functionality)

5. **SOP Version History** (Phase 7)
   - No change tracking for SOPs
   - Impact: Cannot restore previous versions

6. **Timer Pause/Resume** (Phase 4)
   - Only start/stop/discard available
   - Impact: Must stop and restart timer for breaks

7. **Variable Substitution** (Phase 6)
   - Only `{page}` works; missing `{{client_name}}`, `{{site_name}}`
   - Impact: Limited automation in recipes

8. **Per-Type Notification Preferences** (Phase 8)
   - Only bundle toggle available
   - Impact: Users cannot disable specific notification types

9. **Project/Client Report UIs** (Phase 9)
   - Calculations exist, no dashboard
   - Impact: Must query manually for insights

### Lower Priority (Polish & Scale)

10. **Unit/Integration Tests** (Phase 10)
    - Only E2E stubs exist
    - Impact: No test safety net for refactoring

11. **Bulk Operations** (Phase 9)
    - No multi-select or batch actions
    - Impact: Manual operations for bulk changes

12. **CSV Data Import** (Phase 9)
    - File upload works; no CSV parsing
    - Impact: Manual data entry required

13. **Archive Management UI** (Phase 9)
    - Soft delete works; no restore UI
    - Impact: Cannot view/restore deleted items

14. **Error Boundaries** (Phase 8)
    - API errors handled; no UI fallbacks
    - Impact: Crashes show raw error

15. **Responsive Design Polish** (Phase 8)
    - Basic responsive; not mobile-optimized
    - Impact: Suboptimal mobile experience

---

---

## Additional Gaps (from remote-features-audit.md comparison)

### Authentication & User Management
| Feature | Description | Status |
|---------|-------------|--------|
| Forgot Password | Email-based reset request | **Missing** |
| Reset Password | Token-based password reset | **Missing** |
| User CRUD (Admin) | Admin creates/manages users | **Missing** - No admin user management UI |
| Weekly Availability | Hours available per week | **Missing** |
| Hourly Cost | Internal cost tracking per user | **Missing** |
| Velocity Tracking | Calculated from work history | **Missing** |
| User Activation/Deactivation | Soft disable | **Missing** |
| Timezone | User timezone preference | **Missing** |

### Client Enhancements
| Feature | Description | Status |
|---------|-------------|--------|
| Icon/Emoji | Client emoji identifier | **Missing** |
| Primary PM | Assigned PM user | **Missing** |
| Notes Roll-up | Notes from sites/projects shown on client | **Missing** |
| "Prospect" Status | Additional client status | **Missing** - Not in enum |

### Site Enhancements
| Feature | Description | Status |
|---------|-------------|--------|
| Webmaster | Assigned user for site | **Missing** |
| Icon/Emoji | Site emoji identifier | **Missing** |
| Quick Links | Configurable external links (WP admin, etc.) | **Missing** |
| Maintenance Usage | Hours used vs allocation | **Missing** |

### Domain Enhancements
| Feature | Description | Status |
|---------|-------------|--------|
| DNS Provider | Where DNS is managed | **Missing** |
| Account Owner | Who owns registrar account | **Missing** |
| SSL Expiration | Certificate expiry (separate from domain) | **Missing** |
| SSL Alerts | Notify when SSL expiring | **Missing** |

### Project Enhancements
| Feature | Description | Status |
|---------|-------------|--------|
| Meetings Tab | Project meetings | **Missing** |
| Health Indicators | On track / At risk / Behind (PM/Admin) | **Partial** - Calculations exist, no UI |
| Resource Links | Figma, Google Drive, etc. | **Missing** |
| Billing Milestones | Trigger-based billing events | **Missing** |
| Card View Toggle | List view / Card view switch | **Missing** |

### Task Enhancements
| Feature | Description | Status |
|---------|-------------|--------|
| Reviewer Field | Separate from assignee (defaults to PM) | **Missing** |
| Billing Target | Max billable hours | **Missing** |
| Is Billable Flag | Can be billed | **Missing** |
| Is Retainer Work | Counts against retainer | **Missing** |
| No Review Required | Skip review step | **Missing** |
| No Time Tracking | Don't track time for this task | **Missing** |
| Tags | Task categorization | **Missing** |
| Board/Kanban View | Kanban-style status columns | **Missing** |
| Drag-Drop Status | Change status by dragging | **Missing** |
| Comments Thread | Discussion on tasks | **Missing** |

### SOP Enhancements
| Feature | Description | Status |
|---------|-------------|--------|
| Last Reviewed Date | Review tracking | **Missing** |
| Review Interval Days | Days between reviews | **Missing** |
| Review Status | Current / Due Soon / Overdue | **Missing** |

### Recipe Enhancements
| Feature | Description | Status |
|---------|-------------|--------|
| Variable Source | 'sitemap_page' or 'custom' | **Partial** - Only sitemap_page |
| Is Milestone | Approval/gate task | **Missing** |
| Default Billing % | Budget percentage per task | **Missing** |

### Reference Data (Admin)
| Feature | Description | Status |
|---------|-------------|--------|
| Tools CRUD | Plugins, themes, services, software | **Missing** |

### Notes & Comments System
| Feature | Description | Status |
|---------|-------------|--------|
| Notes on Clients | Client-level notes | **Missing** |
| Notes on Sites | Site-level notes | **Missing** |
| Notes on Projects | Project-level notes | **Partial** - Field exists, no rich UI |
| Roll-Up Display | Show child notes on parent | **Missing** |
| Task Comments | Discussion thread | **Missing** |
| Review Feedback | PM comments on returned tasks | **Missing** |

### Meetings
| Feature | Description | Status |
|---------|-------------|--------|
| Create Meeting | Link to client/project | **Missing** |
| Meeting Date/Time | When it occurred | **Missing** |
| Attendees | Internal attendees | **Missing** |
| Meeting/Recording/Transcript Links | Video call URLs | **Missing** |

### Additional Keyboard Shortcuts
| Shortcut | Action | Status |
|----------|--------|--------|
| Cmd+N | New task | **Missing** |
| Cmd+\ | Toggle sidebar | **Missing** |

### Mobile
| Feature | Description | Status |
|---------|-------------|--------|
| Bottom Tab Bar | Primary navigation on mobile | **Missing** |
| Simplified Header | Condensed for mobile | **Partial** |

### Reports (Additional)
| Feature | Description | Status |
|---------|-------------|--------|
| Profitability Report | Revenue/cost by client/project | **Missing** |
| Project Health Report | Status, health, PM, milestones | **Missing** |

---

## Revised Priority Gap List

### Critical (Core Workflow Blockers)

1. **Forgot/Reset Password** (Phase 1)
   - Users cannot recover accounts
   - High urgency for production

2. **Toast Notifications** (Phase 1)
   - No feedback for user actions
   - Quick win with high UX impact

3. **Activity Feed / Audit Logging** (Phase 8)
   - No change tracking or history
   - Required for compliance

4. **Task Comments** (Phase 8)
   - No way for team to discuss tasks
   - Critical for collaboration

### High Priority (Expected Functionality)

5. **User Management (Admin)** (Phase 2)
   - Admin cannot create/edit/deactivate users
   - Must manage users directly in database

6. **Battery Status on Dashboard** (Phase 5)
   - Data exists but not displayed
   - Neurodivergent-friendly feature not visible

7. **Milestone UI** (Phase 3)
   - Schema exists, no management UI
   - Cannot track project checkpoints

8. **Kanban/Board View for Tasks** (Phase 3)
   - Only list view available
   - Expected by many users

9. **Project Health UI** (Phase 5)
   - Calculations exist, no dashboard
   - PMs need visibility into at-risk projects

### Medium Priority (Enhanced Functionality)

10. **Notes System with Roll-up** (Phase 8)
    - No structured notes on entities
    - Would improve client/project documentation

11. **SOP Version History** (Phase 7)
    - No change tracking for SOPs
    - Cannot restore previous versions

12. **SOP Review Status** (Phase 7)
    - No review tracking (due date, overdue)
    - SOPs may become stale

13. **Task Billing Fields** (Phase 3)
    - is_billable, billing_target, is_retainer_work
    - Needed for accurate invoicing

14. **Variable Substitution** (Phase 6)
    - Only `{page}` works
    - Missing `{{client_name}}`, `{{site_name}}`

15. **Tools Reference Data** (Phase 2)
    - No way to track plugins/themes/services
    - Part of admin reference data

### Lower Priority (Polish & Scale)

16. **Meetings Feature** (Phase 3)
    - Listed as MVP placeholder
    - Meeting tracking and transcripts

17. **Quick Links on Sites** (Phase 2)
    - Configurable external links
    - Would improve workflow

18. **Resource Links on Projects** (Phase 3)
    - Figma, Google Drive links
    - Centralized project resources

19. **Additional Keyboard Shortcuts** (Phase 8)
    - Cmd+N for new task
    - Cmd+\ for sidebar toggle

20. **Unit/Integration Tests** (Phase 10)
    - Infrastructure exists, no tests
    - Technical debt

---

## Recommended Next Steps

### Immediate (Production Blockers)
1. **Forgot/Reset Password** - Critical for user self-service
2. **Toast Notifications** - Add sonner or react-hot-toast library
3. **User Management UI** - Admin needs to manage users

### Short-Term (Core UX)
4. **Task Comments** - Enable team collaboration
5. **Kanban Board View** - Popular task visualization
6. **Battery Status on Dashboard** - Already have data, just display it
7. **Activity Logging** - Start tracking changes

### Medium-Term (Enhanced Features)
8. **Milestone UI** - Schema ready
9. **Project Health Dashboard** - Calculations ready
10. **Notes System** - Rich notes with roll-up
11. **SOP Review Tracking** - Prevent stale documentation
