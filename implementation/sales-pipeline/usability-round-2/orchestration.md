# Orchestration — Usability Round 2

## Execution Model

This work is executed by Claude Code sub-agents dispatched by an orchestrating agent. **Follow the agent-based workflow in CLAUDE.md exactly.** The orchestrator should read CLAUDE.md before dispatching any implementation agents.

---

## Execution Order

### Phase 1: Data Model & API (from `01-data-model-changes.md`)

Complete all backend work before touching any UI.

#### Step 1.1 — Impact Analysis (PARALLEL sub-agents)

**Sub-Agent A: Codebase Impact Analysis**
- Search for ALL references to `AccordLineItem` across the codebase (schema, types, hooks, API routes, formatters, components, tests)
- Search for all references to `line_items` in Accord includes/queries
- Search for all imports from `use-accords.ts` that reference line item hooks
- Search for `formatAccordLineItemResponse` usage
- Search for `/api/accords/[id]/line-items/` route files
- Identify every file that will need modification when AccordLineItem is removed
- **Output:** Complete list of files and specific lines that reference the old line item system

**Sub-Agent B: Test Impact Analysis**
- Find ALL test files that reference AccordLineItem, line_items, or line-item API routes
- Find tests that assert on Accord response shapes containing `line_items`
- Find tests for the accord formatter that include line item formatting
- **Output:** List of test files needing updates, with specific assertions that will break

#### Step 1.2 — Schema Migration (single sub-agent)

**Sub-Agent: Schema & Migration**
- Read current `prisma/schema.prisma`
- Add the three new models: `AccordCharterItem`, `AccordCommissionItem`, `AccordKeepItem`
- Add `CharterRenewalLog` model
- Add new fields to `Ware` model (`renewal_lead_time_days`, `default_duration_months`)
- Add new fields to `Charter` model (`duration_months`, `renewal_date`, `site_id`)
- Update `Accord` model relations (add three new item relations)
- **DO NOT remove AccordLineItem yet** — that happens after the new system is working
- Run `npx prisma migrate dev --name add-accord-item-tables`
- Run `npx prisma generate`
- Verify the dev server restarts cleanly (kill and restart if needed — lesson from prior incident)
- Run `npx tsc --noEmit` to verify no type errors
- Run `npm test` to verify no test regressions

#### Step 1.3 — API Routes (PARALLEL sub-agents)

Dispatch three sub-agents in parallel, one per item type. Each reads existing API patterns first.

**Sub-Agent: Charter Item API**
- Read `/app/api/accords/[id]/line-items/` routes as reference pattern
- Create `/app/api/accords/[id]/charter-items/route.ts` (GET list, POST create)
- Create `/app/api/accords/[id]/charter-items/[itemId]/route.ts` (PATCH update, DELETE soft-delete)
- POST validation: ware must be `type = 'charter'`, calculate `final_price` and `total_contract_value`
- PATCH: recalculate computed fields when price/discount/duration changes
- Add formatters: `formatAccordCharterItemResponse` in `formatters.ts`
- Add to API registry
- Write tests for all endpoints
- Run tests

**Sub-Agent: Commission Item API**
- Same pattern as charter items but for commission type
- POST validation: ware must be `type = 'commission'`
- Handle nullable `project_id` and `estimated_price`
- Calculate `final_price` from project budget or estimated price minus discount
- Handle project linking via PATCH (when project_id changes, recalc price)
- Add formatters, registry entries, tests

**Sub-Agent: Keep Item API**
- Create keep item routes
- No ware validation (keeps aren't wares)
- Validate `maintenance_plan_id` is always present
- Validate `hosting_plan_id` is null when `is_client_hosted = true`
- Calculate `hosting_final_price`, `maintenance_final_price`, `monthly_total`
- Handle site linking via PATCH
- Add formatters, registry entries, tests

#### Step 1.4 — Accord Detail Endpoint Update (single sub-agent)

**Sub-Agent: Update Accord Responses**
- Update `/app/api/accords/[id]/route.ts` GET to include charter_items, commission_items, keep_items
- Update `/app/api/accords/route.ts` GET to include counts for new item types (replace `_count: { select: { line_items: true } }`)
- Update `formatAccordResponse` to include new item arrays and computed revenue fields (mrr, total_project_value, total_contract_value)
- Update existing tests for accord endpoints
- Run ALL accord-related tests

#### Step 1.5 — Terminology Update (single sub-agent)

**Sub-Agent: Terminology**
- Add `keep` / `keeps` / `newKeep` to `use-terminology.ts`
- Verify no type errors

#### Step 1.6 — Type Definitions (single sub-agent)

**Sub-Agent: Types**
- Add `AccordCharterItem`, `AccordCommissionItem`, `AccordKeepItem` interfaces to `types/entities.ts`
- Update `AccordWithRelations` to include new item arrays and computed fields
- **DO NOT remove `AccordLineItem` type yet**
- Run `npx tsc --noEmit`

#### Step 1.7 — React Query Hooks (single sub-agent)

**Sub-Agent: Hooks**
- Create `lib/hooks/use-accord-items.ts` with hooks for all three item types (12 hooks total)
- Add query keys to `lib/api/query-keys.ts`
- Follow exact patterns from existing `useAddAccordLineItem` etc.
- All mutations invalidate `accordKeys.detail(accordId)`
- Write hook tests

#### Step 1.8 — Verification Gate

**Sub-Agent: Full Test Run**
- Run `npx tsc --noEmit`
- Run `npm test`
- Report any failures
- **DO NOT proceed to Phase 2 until all tests pass**

---

### Phase 2: UI Rework (from `02-accord-screen-rework.md`)

Only begin after Phase 1 is fully verified.

#### Step 2.1 — Impact Analysis (PARALLEL sub-agents)

**Sub-Agent A: UI Impact Analysis**
- Read the full Accord detail page (`app/(app)/deals/[id]/page.tsx`)
- Identify all line item rendering code (table, form, state variables, handlers)
- Identify the lead info static display section
- Map out what needs to be removed vs modified
- **Output:** Specific line ranges to remove/replace

**Sub-Agent B: Component Pattern Analysis**
- Read existing section/card patterns from the Accord detail page
- Read `HostingPlanSelect` and `MaintenancePlanSelect` inline edit components
- Read `ProjectForm` and `SiteForm` modal patterns
- Read `Combobox` component API
- **Output:** Pattern references for building the new sections

#### Step 2.2 — Shared Components (single sub-agent)

**Sub-Agent: Shared Components**
- Create `components/domain/accords/accord-items/DiscountFields.tsx`
  - Reusable discount type select + value input + calculation preview
  - Props: basePrice, discountType, discountValue, onChange, billingPeriodLabel (optional)
- Verify component compiles

#### Step 2.3 — Section Components (PARALLEL sub-agents)

**Sub-Agent: Charter Items UI**
- Create `CharterItemsSection.tsx` — section wrapper with collapsible card, add button, table, subtotals
- Create `CharterItemForm.tsx` — inline form with ware selection, tier, pricing, discount, duration
- Create `CharterItemRow.tsx` — table row with inline edit capability
- Use `useAccordCharterItems`, `useAddAccordCharterItem`, etc. hooks
- Use `DiscountFields` shared component
- Use terminology hook for all labels
- Wire up ware Combobox filtered to `type = 'charter'`

**Sub-Agent: Commission Items UI**
- Create `CommissionItemsSection.tsx`, `CommissionItemForm.tsx`, `CommissionItemRow.tsx`
- Wire project Combobox with "Create New Project" option
- "Create New Project" opens ProjectForm in a modal, pre-fills client
- Include "Create and Open" button that navigates to project detail
- Handle TBD state display (no price, no project)

**Sub-Agent: Keep Items UI**
- Create `KeepItemsSection.tsx`, `KeepItemForm.tsx`, `KeepItemRow.tsx`
- Use existing `HostingPlanSelect` and `MaintenancePlanSelect` components
- Wire site Combobox with "Create New Site" option
- "Create New Site" opens SiteForm in a modal, pre-fills client
- Include "Create and Open" button
- Handle `is_client_hosted` toggle (hide/show hosting fields)
- Show price override warning when price differs from plan rate

#### Step 2.4 — Page Integration (single sub-agent)

**Sub-Agent: Accord Detail Page Update**
- Read current `app/(app)/deals/[id]/page.tsx` in full
- Remove all old line item code:
  - State variables: `selectedWareId`, `lineItemPrice`, `lineItemQuantity`, `showLineItemForm`
  - The line items Card/table/form JSX
  - Old line item hook imports
- Add revenue summary row below header
- Add three section components in Overview tab
- Replace static lead info with inline-editable fields
- Import and use new hooks
- Verify page renders without errors

#### Step 2.5 — Kanban Card Update (single sub-agent)

**Sub-Agent: AccordCard**
- Update `AccordCard.tsx` to show MRR from accord data when available
- Keep change minimal — one line of small text

#### Step 2.6 — Verification Gate

**Sub-Agent: Full Test Run**
- Run `npx tsc --noEmit`
- Run `npm test`
- Report failures
- Fix any issues

---

### Phase 3: Cleanup (after both phases verified)

#### Step 3.1 — Legacy Removal

**Sub-Agent: Remove Old Line Item System**
- Check if any AccordLineItems exist in the database: `SELECT COUNT(*) FROM "AccordLineItem"`
- If count > 0: write and run a data migration categorizing items into new tables based on ware type
- If count = 0: proceed directly
- Remove `AccordLineItem` model from `schema.prisma`
- Run migration: `npx prisma migrate dev --name remove-accord-line-item`
- Remove `formatAccordLineItemResponse` from formatters
- Remove `/api/accords/[id]/line-items/` route directory
- Remove `useAddAccordLineItem`, `useUpdateAccordLineItem`, `useDeleteAccordLineItem` from `use-accords.ts`
- Remove `AccordLineItem` from `types/entities.ts`
- Remove from API registry
- Remove old line item query key patterns
- Run `npx prisma generate`
- Run `npx tsc --noEmit` — fix any remaining references
- Run `npm test` — fix any broken tests

#### Step 3.2 — Final Verification

**Sub-Agent: Complete Test Suite**
- `npx tsc --noEmit`
- `npm test`
- All tests must pass
- Report final state

---

## Critical Rules

1. **ALWAYS regenerate Prisma client after migrations.** Run `npx prisma generate` after every `prisma migrate dev`. Then restart the dev server.

2. **Never skip impact analysis.** The old line item system is referenced in many places. Missing a reference means a runtime error in production.

3. **Tests must pass at every step.** Do not proceed to the next phase if tests are failing. Fix them first.

4. **Don't remove old code until new code works.** The AccordLineItem system stays in place until Phase 3. Both old and new can coexist during development.

5. **Use sub-agents for all implementation.** The orchestrating agent should not write code directly. Dispatch sub-agents for focused tasks and coordinate results.

6. **Follow existing patterns.** Read the reference files before writing. The codebase has established patterns for API routes, hooks, formatters, and components. New code should be indistinguishable from existing code.

7. **Read CLAUDE.md first.** It contains the full component library reference, API route patterns, testing requirements, and other rules that sub-agents must follow.

8. **BlockNote editor fields are optional expansions.** The `contract_language_override` fields use BlockNote. Only render the editor when the user explicitly clicks "Add custom clause" — don't show empty editors taking up space.

9. **Inline forms, not modals, for line item add/edit.** The only modals are for creating projects and sites (which use existing form components). Line item configuration happens inline in the page.

10. **The dev server must be running** for manual verification. After UI changes, the orchestrator should confirm the page renders. If the dev server isn't running, start it with `cd app && npm run dev`.
