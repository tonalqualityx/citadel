# Sales Pipeline — Orchestration Guide

## Purpose

This document is targeted at the **orchestrating agent** that manages the end-to-end implementation of the Citadel Sales Pipeline (Parley) system. It provides the context, sequencing, delegation patterns, and verification criteria needed to coordinate the build.

---

## Architecture

**Agent hierarchy:**
1. **Top-level orchestrator** (you) — has browser access, can verify work visually, initiates Claude Code sessions
2. **Claude Code orchestrator** — receives phase instructions, dispatches sub-agents for implementation
3. **Claude Code sub-agents** — handle discrete tasks: reading files, writing code, running tests, checking work

**Key principle:** Sub-agents always read before writing. Sub-agents always run tests after writing. All existing tests must pass before any phase is considered complete.

---

## Repository Location

- **Repo root:** `/home/mike/.openclaw/workspace/citadel`
- **App directory:** `/home/mike/.openclaw/workspace/citadel/app`
- **Planning docs:** `/home/mike/.openclaw/workspace/citadel/implementation/sales-pipeline/`
- **Prisma schema:** `/home/mike/.openclaw/workspace/citadel/app/prisma/schema.prisma`
- **API routes:** `/home/mike/.openclaw/workspace/citadel/app/app/api/`
- **Frontend pages:** `/home/mike/.openclaw/workspace/citadel/app/app/(app)/`
- **Components:** `/home/mike/.openclaw/workspace/citadel/app/components/`
- **Hooks:** `/home/mike/.openclaw/workspace/citadel/app/lib/hooks/`
- **Services:** `/home/mike/.openclaw/workspace/citadel/app/lib/services/`
- **Calculations:** `/home/mike/.openclaw/workspace/citadel/app/lib/calculations/`
- **API registry:** `/home/mike/.openclaw/workspace/citadel/app/lib/api/registry/`
- **Formatters:** `/home/mike/.openclaw/workspace/citadel/app/lib/api/formatters.ts`
- **Auth middleware:** `/home/mike/.openclaw/workspace/citadel/app/lib/auth/middleware.ts`
- **Terminology:** `/home/mike/.openclaw/workspace/citadel/app/lib/hooks/use-terminology.ts`
- **Existing tests:** Colocated in `__tests__/` directories throughout the codebase

---

## Planning Documents

Read these in order before starting any implementation:

| Document | Contents |
|----------|----------|
| `01-data-model.md` | All new entities, fields, relationships, enums, business rules |
| `02-screens-and-flows.md` | Every screen, component, user flow, email template |
| `03-phased-build-plan.md` | Sequenced phases with dependencies and exit criteria |

These documents are the source of truth for what to build. If implementation reveals a conflict with these docs, **pause and flag it** rather than making assumptions.

---

## Pre-Implementation Phase

**Before writing any production code**, dispatch these sub-agents in parallel:

### Sub-Agent A: Component Audit
- **Task:** Review all components in `/components/ui/` and `/components/domain/`
- **Output:** `implementation/sales-pipeline/component-audit.md`
- **Contents:**
  - List of reusable components with capabilities (DataTable, TaskList, Modal, forms, etc.)
  - Existing dnd-kit usage patterns (for kanban board)
  - Existing rich text editor usage (for proposal/contract content)
  - Components that need extension vs new components needed
  - Inline editing patterns already available

### Sub-Agent B: Conflict Analysis
- **Task:** Crawl codebase for potential conflicts with the sales pipeline implementation
- **Output:** `implementation/sales-pipeline/conflict-analysis.md`
- **Contents:**
  - Every file referencing "Pact" or "pact" (terminology rename scope)
  - Every file referencing `project.type === 'retainer'` or retainer logic (Charter migration impact)
  - Status transition logic that may need updating
  - Navigation/sidebar code that needs modification
  - Query key patterns that need new entries
  - API registry files that need updates
  - Existing hooks that need modification vs new hooks needed
  - Potential routing conflicts
  - Solutions/approach for each identified conflict

### Sub-Agent C: Test Baseline
- **Task:** Run all existing tests, document results
- **Output:** `implementation/sales-pipeline/test-baseline.md`
- **Contents:**
  - Full test run results (pass/fail counts)
  - List of test files and what they cover
  - Tests that reference terminology being changed
  - Tests that reference retainer logic being moved
  - Any currently failing tests (pre-existing issues)

**Gate:** All three sub-agent reports must be complete and reviewed before Phase 1 begins.

---

## Phase Execution Pattern

For each phase, Claude Code should follow this pattern:

### 1. Plan
- Read the relevant sections of the planning docs
- Read the component audit and conflict analysis
- Identify the specific files to create/modify
- Create a phase-specific implementation plan if the phase is complex

### 2. Implement (via sub-agents)
- Dispatch sub-agents for independent work streams within the phase
- Each sub-agent:
  - Reads existing code before modifying
  - Writes code following existing patterns (formatters, error handling, Zod validation, etc.)
  - Writes tests for new code
  - Runs tests to verify
- Sub-agents should NOT work on the same files simultaneously

### 3. Verify
- Run ALL tests (not just new ones)
- Check that no existing tests are broken
- Verify new code follows project conventions

### 4. Document
- Update `implementation/sales-pipeline/` with any deviations from plan
- Update API registry if new endpoints were added
- Log completion status

---

## Phase Sequence & Key Instructions

### Phase 1: Foundation
**Focus:** Schema and terminology only. No UI.
- Terminology rename is the highest-risk change — it touches many files
- Run full test suite after terminology rename before proceeding to schema changes
- Schema migration should be a single migration file
- Test that migration applies cleanly on a fresh database

### Phase 2: Wares & Accords CRUD
**Focus:** API + UI for core entities.
- Follow existing CRUD patterns exactly (see `/app/api/clients/` as reference)
- Kanban board is the most complex UI component — may need a new shared component
- Reuse existing dnd-kit patterns from project task reordering
- Test API endpoints thoroughly — these are the foundation for everything else

### Phase 3: Proposals & MSA
**Focus:** First client-facing features.
- SendGrid integration is a dependency — verify credentials work before building email flows
- Portal routes are PUBLIC (no auth) — security is token-based only
- Portal UI should be a separate layout, not using the app layout
- Test token generation, validation, and expiry carefully
- Proposal acceptance → contract generation is a critical automation — test the full flow

### Phase 4: Contracts & Signing
**Focus:** Legal signing flow.
- Content snapshots are critical — what the client signed must be immutable
- PDF generation may require Puppeteer — check if it's available in the deployment environment
- Onboarding flow (lead → client) creates data — test that Client creation works correctly
- The signing → activation flow (creating Commissions/Charters) is the most complex automation — test exhaustively

### Phase 5: Charters
**Focus:** Retainer management.
- Recurring task generation follows the maintenance generator pattern but is project-centric
- Test mixed cadences (monthly + quarterly in same Charter)
- Budget tracking calculations need thorough testing
- Commission ↔ Charter linking and auto-archival on completion

### Phase 6: Automation & Addendums
**Focus:** Automation engine and scope change management.
- Time-based automation needs idempotency (don't create duplicate tasks)
- Scope change guardrail is a frontend intercept — test that it fires correctly on locked Commissions
- Addendum acceptance must correctly update Accord line items and downstream entities

---

## Verification Checklist (Every Phase)

The orchestrating agent should verify after each phase:

- [ ] All existing tests pass
- [ ] All new tests pass
- [ ] New API endpoints return correct responses (test via browser or curl)
- [ ] New UI screens render without errors (verify visually via browser)
- [ ] Navigation updates work (sidebar shows new items)
- [ ] No console errors in browser
- [ ] Activity logging works for new entities
- [ ] Soft delete works for new entities
- [ ] Pagination works on new list endpoints
- [ ] Search works on new list endpoints
- [ ] Role-based access control enforced (PM/Admin only for Parley)

---

## Key Conventions to Follow

These are established patterns in the Citadel codebase that must be followed:

| Convention | Reference File |
|------------|---------------|
| API error handling | `lib/api/errors.ts` |
| Response formatting | `lib/api/formatters.ts` |
| Auth middleware | `lib/auth/middleware.ts` |
| Zod validation | Any `route.ts` file (e.g., `api/clients/route.ts`) |
| React Query hooks | `lib/hooks/use-clients.ts` |
| Query key factory | `lib/api/query-keys.ts` |
| Activity logging | `lib/services/activity.ts` |
| Status transitions | `lib/calculations/status.ts` |
| Soft delete pattern | Any existing DELETE endpoint |
| Toast notifications | `lib/hooks/use-toast.ts` |
| Component styling | `components/ui/button.tsx` (CVA pattern) |
| Terminology usage | `lib/hooks/use-terminology.ts` |
| API registry | `lib/api/registry/` domain files |
| Cron endpoints | `api/cron/maintenance/route.ts` |

---

## Risk Areas

| Risk | Mitigation |
|------|------------|
| Terminology rename breaks existing UI | Run full test suite + visual check after rename |
| Portal security (no auth) | Cryptographic tokens, expiry, IP logging, rate limiting |
| Contract generation produces bad output | Preview before sending, manual edit capability |
| Recurring task generation conflicts with maintenance | Separate code paths, shared patterns, no shared tables |
| Scope lock guardrail bypassed | Backend enforcement + frontend prompt (defense in depth) |
| Email delivery failures | Queue + retry, don't block main flow on email failure |
| Large migration on production DB | Test migration on staging/backup first |

---

## Communication Protocol

- **Blocking issues:** If a phase cannot proceed due to a conflict, dependency, or unclear requirement, STOP and report to the user. Do not make assumptions about business logic.
- **Deviations from plan:** If implementation reveals that the planned approach won't work, document the issue and proposed alternative in `implementation/sales-pipeline/deviations.md` before proceeding.
- **Phase completion:** After each phase, provide a summary of what was built, what tests were added, and any issues encountered.

---

## Files Generated During Implementation

Each phase should produce artifacts in `implementation/sales-pipeline/`:

| File | When | Contents |
|------|------|----------|
| `component-audit.md` | Pre-implementation | Reusable components analysis |
| `conflict-analysis.md` | Pre-implementation | Codebase conflict identification |
| `test-baseline.md` | Pre-implementation | Current test state |
| `deviations.md` | As needed | Any changes from the original plan |
| `phase-N-completion.md` | After each phase | Summary of work done, tests added, issues |
