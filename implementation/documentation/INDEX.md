# Indelible Phase Implementation Guides
## Index & Quick Reference

This directory contains detailed implementation guides for each phase of the Indelible project. These documents are designed to be read by Claude Code at the start of each development session.

---

## ðŸ“š Document Inventory

| Phase | Document | Duration | Focus |
|-------|----------|----------|-------|
| 1 | [PHASE-01-FOUNDATION.md](./phases/PHASE-01-FOUNDATION.md) | 2-3 days | Next.js setup, Database, Auth, App Shell |
| 2 | [PHASE-02-CORE-ENTITIES.md](./phases/PHASE-02-CORE-ENTITIES.md) | 3-4 days | Clients, Sites, Domains CRUD |
| 3 | [PHASE-03-PROJECTS-TASKS.md](./phases/PHASE-03-PROJECTS-TASKS.md) | 4-5 days | Projects, Tasks, Status Workflows |
| 4 | [PHASE-04-TIME-TRACKING.md](./phases/PHASE-04-TIME-TRACKING.md) | 2-3 days | Timer, Time Entries, Chronicles |
| 5 | [PHASE-05-DASHBOARDS.md](./phases/PHASE-05-DASHBOARDS.md) | 2-3 days | Role-specific Overlooks |
| 6 | [PHASE-06-RECIPE-WIZARD.md](./phases/PHASE-06-RECIPE-WIZARD.md) | 3-4 days | Project Templates, Wizard |
| 7 | [PHASE-07-SOPS-RICHTEXT.md](./phases/PHASE-07-SOPS-RICHTEXT.md) | 2-3 days | TipTap Editor, SOPs |
| 8 | [PHASE-08-NOTIFICATIONS-POLISH.md](./phases/PHASE-08-NOTIFICATIONS-POLISH.md) | 2-3 days | Notifications, Search, Preferences |
| 9 | [PHASE-09-REPORTS-DATA.md](./phases/PHASE-09-REPORTS-DATA.md) | 2-3 days | Retainers, Reports, Export |
| 10 | [PHASE-10-TESTING-DEPLOYMENT.md](./phases/PHASE-10-TESTING-DEPLOYMENT.md) | 3-4 days | E2E Tests, CI/CD, Launch |

**Total Estimated Duration: 25-33 days**

---

## ðŸš€ How to Use These Documents

### At Session Start

1. **Read the Master Instructions first:**
   ```
   view /path/to/CLAUDE-CODE-MASTER-INSTRUCTIONS.md
   ```

2. **Check Progress Tracker** to identify current phase

3. **Read the current phase document:**
   ```
   view /path/to/phase-docs/PHASE-XX-NAME.md
   ```

4. **Review any prerequisite planning documents** listed in "Required Reading"

5. **Begin with the Reader Agent pattern** â€” search existing code before writing

### During Development

- Follow the **checklist** in each phase document
- Mark items complete as you progress
- Use the **code patterns** provided as templates
- Run tests after each major section

### At Session End

- Update progress in Master Instructions
- Note any blockers or deviations
- Commit with descriptive message

---

## ðŸ“‹ Phase Dependencies

```
Phase 1: Foundation
    â†“
Phase 2: Core Entities
    â†“
Phase 3: Projects & Tasks
    â†“
Phase 4: Time Tracking
    â†“
Phase 5: Dashboards
    â†“
Phase 6: Recipe Wizard
    â†“
Phase 7: SOPs & Rich Text
    â†“
Phase 8: Notifications & Polish
    â†“
Phase 9: Reports & Data
    â†“
Phase 10: Testing & Deployment
```

Each phase builds on the previous. Do not skip phases or work out of order without careful consideration of dependencies.

---

## ðŸ”‘ Key Concepts by Phase

### Phase 1 â€” Foundation
- Next.js App Router structure
- Prisma + PostgreSQL
- JWT authentication with HTTP-only cookies
- Global layout with Sidebar + Header

### Phase 2 â€” Core Entities
- React Query for data fetching
- Query Key Factory pattern
- API route patterns (requireAuth, handleApiError)
- CRUD with soft delete

### Phase 3 â€” Projects & Tasks
- Project status gates task visibility
- Task status state machine
- Energy estimation calculations
- Blocking dependencies

### Phase 4 â€” Time Tracking
- Global Timer Context
- Timer persistence across navigation
- Time entry creation from timer
- Manual time entry

### Phase 5 â€” Dashboards
- Role-based data queries
- Tech visibility restrictions
- Focus tasks for PMs
- Admin overview

### Phase 6 â€” Recipe Wizard
- Multi-step wizard state
- Recipe templates
- Variable task generation
- Team function mapping

### Phase 7 â€” SOPs & Rich Text
- TipTap integration
- JSON content storage
- Read-only rendering
- Template requirements

### Phase 8 â€” Notifications & Polish
- Bundled notifications
- Global search (Cmd+K)
- User preferences
- Terminology switching

### Phase 9 â€” Reports & Data
- Retainer tracking
- Time report aggregation
- Project health scoring
- CSV export

### Phase 10 â€” Testing & Deployment
- Playwright E2E tests
- GitHub Actions CI
- Cloudways deployment
- Data migration

---

## ðŸ“„ Related Documents

These phase guides reference the following planning documents:

| Document | Purpose |
|----------|---------|
| `CLAUDE-CODE-MASTER-INSTRUCTIONS.md` | Coding conventions, utility registry, sub-agent workflow |
| `architecture/indelible-data-model-refinement.md` | Complete database schema |
| `architecture/indelible-api-endpoint-inventory.md` | All API endpoints |
| `architecture/indelible-auth-design.md` | Authentication strategy |
| `architecture/indelible-state-management-plan.md` | React Query patterns |
| `architecture/indelible-navigation-sitemap.md` | Route structure, role-based navigation |
| `wireframes/indelible-wireframes-*.md` | UI specifications |
| `architecture/indelible-component-library.md` | Reusable components |
| `architecture/indelible-testing-strategy.md` | Test approach |
| `architecture/indelible-deployment-devops.md` | Infrastructure |
| `reference/indelible-migration-runbook.md` | Data migration |

---

## 📂 Implementation Directory Structure

The repository includes an `/implementation` directory with reference materials:

```
/implementation
├── /documentation              # Claude Code instruction documents
│   ├── CLAUDE-CODE-MASTER-INSTRUCTIONS.md
│   ├── INDEX.md                # This file
│   ├── indelible-implementation-plan.md
│   ├── /phases                 # Phase-specific implementation guides
│   │   └── PHASE-01 through PHASE-10
│   ├── /architecture           # Technical design documents
│   │   └── auth, api, data model, components, etc.
│   ├── /wireframes             # UI specifications
│   │   └── indelible-wireframes-*.md
│   └── /reference              # Supporting reference docs
│       └── migration runbook, schema addendum, notion schema
└── /mockups                    # Visual mockups with code samples
    ├── /admin-screens
    ├── /components
    ├── /dashboard-overlooks
    ├── /pacts-projects
    ├── /patrons-clients
    ├── /quests
    ├── /sites
    ├── /tools
    └── /user-settings
```


### Using Mockups

Before building any UI component:

1. **Check `/implementation/mockups/`** for existing reference implementations
2. **View the PNG preview** to understand the visual target
3. **Review the sample code** for patterns and styling
4. **Extract reusable elements** into the component library first
5. **Build the feature component** using library components

---

## ðŸ§± Component Library First â€” MANDATORY

**â›” CRITICAL RULE:** Every UI element MUST come from the component library. No exceptions.

```
Need a button, badge, card, input, or ANY styled element?
  â†“
Step 1: Check /components/ui/ â€” Does it exist?
  â†“
  YES â†’ Import and use it
  NO  â†’ Create it in /components/ui/ FIRST
  â†“
Step 2: THEN use it in your feature component
  â†“
NEVER skip to inline styles. NEVER create one-off elements.
```

**Why?** The library is the SINGLE SOURCE OF TRUTH:
- Change a button's style once â†’ updates everywhere
- Consistent look and feel across the entire app
- No "why does this button look different?" bugs
- Faster development after initial setup

**Reviewer agents will reject code that:**
- Has inline Tailwind for buttons, cards, badges, inputs, modals
- Creates styled elements without checking the library first
- Duplicates patterns that exist in `/components/ui/`

See the Master Instructions for full Component Library Rules.

---

## âœ… Quick Start Checklist

```markdown
[ ] Read CLAUDE-CODE-MASTER-INSTRUCTIONS.md
[ ] Identify current phase from Progress Tracker
[ ] Read current phase document
[ ] Review "Required Reading" planning docs
[ ] Check Utility Registry for existing functions
[ ] Plan today's tasks
[ ] Begin with Reader Agent (search before write)
```

## ðŸŽ¨ UI Pre-Flight Checklist (Before ANY UI Work)

```markdown
[ ] Checked /implementation/mockups/ for visual reference
[ ] Checked /components/ui/ for existing elements
[ ] If element missing â†’ Created in /components/ui/ FIRST
[ ] Domain component imports from /components/ui/
[ ] NO inline Tailwind for buttons/cards/badges/inputs/modals
[ ] Used CVA for variants (not separate components)
```

**If you can't check all boxes, stop and fix before proceeding.**
