# Accord Screen Rework — Three-Section Line Items & Lead Editing

## Overview

The Accord detail page replaces its single generic line items table with three purpose-built sections: **Charter Items** (recurring services), **Commission Items** (projects), and **Keep Items** (hosting + maintenance). Lead info becomes editable inline. Computed revenue fields (MRR, total project value, total contract value) display in the header.

---

## Revenue Summary — Header Update

Add a revenue summary row below the existing header info (name, status, client, owner).

**Display fields (computed, not stored):**

| Label | Calculation | Format |
|-------|-------------|--------|
| MRR | Sum of charter item `final_price` (monthly-normalized) + keep item `monthly_total` | `$X,XXX.XX/mo` |
| Project Value | Sum of commission item `final_price` (or "TBD" if any are null) | `$X,XXX.XX` or `$X,XXX.XX + TBD` |
| Total Contract Value | Sum of charter `total_contract_value` + keep `monthly_total` × max charter duration + project value | `$X,XXX.XX` |

**Layout:** Three stat cards in a horizontal row, using the existing Card component. If all values are zero/null, show the row with `$0.00` values — don't hide it.

**Monthly normalization for MRR:** Charter items billed annually → divide `final_price` by 12 to get monthly equivalent.

---

## Lead Info — Inline Editing

**Current state:** Lead fields (name, business name, email, phone, notes) render as static text in the Overview tab around lines 342-396.

**Change:** Replace static text with inline-editable fields using the existing `InlineEdit` component pattern from the codebase. Each field saves on blur via `useUpdateAccord`.

**Fields:**
- Lead Name → `InlineEditText`
- Lead Business Name → `InlineEditText`
- Lead Email → `InlineEditText` (type="email")
- Lead Phone → `InlineEditText` (type="tel")
- Lead Notes → `InlineEditTextarea`

**Behavior:**
- Click text to enter edit mode
- Blur or Enter saves via PATCH `/api/accords/[id]`
- Escape cancels edit
- Show subtle pencil icon on hover to indicate editability
- Validation: email field validates format before save

**Conditional display:** Lead info section only shows when `client_id` is null. When a client is linked, the client card replaces lead info (existing behavior).

---

## Three-Section Line Items Layout

Replace the single "Line Items" card with three collapsible sections, each in its own Card. Display order: **Charters → Commissions → Keeps**.

Each section has:
- Section header with icon, title (using terminology hook), and item count badge
- Collapsible content (default expanded if items exist, collapsed if empty)
- "Add" button in the header
- Table of existing items
- Section subtotal row

**Visibility:** All three sections are always visible regardless of accord status. Even in `lead` stage, the user should be able to start planning line items.

---

## Charter Items Section

### Table Columns

| Column | Source | Notes |
|--------|--------|-------|
| Name | `name_override` or `ware.name` | Linked to ware detail page |
| Tier | `price_tier` | Badge, e.g. "Medium" |
| Base Price | `base_price` | Currency format |
| Discount | discount display | e.g. "10%" or "$50" or "—" |
| Price/Period | `final_price` | Currency + billing period label |
| Billing | `billing_period` | "Monthly" or "Annually" |
| Duration | `duration_months` | e.g. "12 months" |
| Contract Value | `total_contract_value` | Currency format |
| Actions | edit, delete | Icon buttons |

### Add Charter Item Flow

**Trigger:** "Add Charter" button in section header.

**Step 1 — Ware Selection (inline or modal):**
- Combobox filtered to `type = 'charter'` wares only
- Options show: ware name, base price, billing period
- On select, the form populates with ware defaults

**Step 2 — Item Configuration Form (slide-down inline form, not modal):**

| Field | Source | Behavior |
|-------|--------|----------|
| Name Override | text input | Optional. Blank = use ware name |
| Price Tier | Select | Options from ware's pricing tiers (if ware has tiers). Selecting a tier sets `base_price` |
| Base Price | currency input | Pre-filled from tier or ware.base_price. Editable for manual override |
| Discount Type | Select | "None", "Percent", "Flat" |
| Discount Value | number input | Shows when discount type ≠ None |
| Final Price | read-only | Auto-calculated. Updates live as user changes inputs |
| Billing Period | Select | "Monthly" or "Annually". Pre-filled from ware default |
| Duration | number input | Months. Pre-filled from ware.default_duration_months or 12 |
| Total Contract Value | read-only | Auto-calculated. Updates live |
| Contract Language | BlockNote editor | Optional. Only show if user clicks "Add custom clause" link |

**Calculation display:** Show the math inline below final_price:
- Percent: `$500.00 - 10% = $450.00/mo`
- Flat: `$500.00 - $50.00 = $450.00/mo`
- None: `$500.00/mo`

**Save:** POST to `/api/accords/[id]/charter-items`. On success, item appears in table, form collapses.

### Edit Charter Item

Click edit icon → same form appears inline (replacing the table row), pre-filled with current values. Save = PATCH, cancel = collapse back to row.

### Delete Charter Item

Click delete icon → confirmation dialog → soft delete via DELETE endpoint.

---

## Commission Items Section

### Table Columns

| Column | Source | Notes |
|--------|--------|-------|
| Name | `name_override` or `ware.name` | Linked to ware detail page |
| Project | `project.name` or "Not linked" | If linked, clickable to project detail |
| Est. Price | `estimated_price` | Shows when no project linked |
| Discount | discount display | e.g. "10%" or "$50" or "—" |
| Final Price | `final_price` | Currency or "TBD" if null |
| Actions | edit, link project, delete | Icon buttons |

### Add Commission Item Flow

**Step 1 — Ware Selection:**
- Combobox filtered to `type = 'commission'` wares only

**Step 2 — Item Configuration Form (inline):**

| Field | Source | Behavior |
|-------|--------|----------|
| Name Override | text input | Optional |
| Estimated Price | currency input | Optional. For early-stage rough pricing |
| Project | Combobox | Select existing project OR "Create New Project" option |
| Discount Type | Select | "None", "Percent", "Flat" |
| Discount Value | number input | Shows when discount type ≠ None |
| Final Price | read-only | Auto-calculated from project budget or estimated price minus discount |
| Contract Language | BlockNote editor | Optional, behind "Add custom clause" link |

**"Create New Project" option:** When selected from the project Combobox:
- Open the existing ProjectForm in a modal (size="lg")
- Pre-fill client from the Accord's client (if exists)
- On successful project creation, auto-link to this commission item
- Offer "Create and Open" button alongside "Create" — this saves + navigates to the new project's detail page

**Price logic display:**
- If project linked with budget: show `Project budget: $X,XXX.XX` then discount math
- If no project, estimated price entered: show `Estimated: $X,XXX.XX` then discount math
- If neither: show "TBD" badge

### Edit Commission Item

Same inline edit pattern as charter items.

### Link/Change Project

Dedicated action: clicking the "link" icon opens a Combobox dropdown to select or create a project. When a project is linked, its `budget_amount` becomes the base price.

---

## Keep Items Section

### Table Columns

| Column | Source | Notes |
|--------|--------|-------|
| Site | `site.name` or `site_name_placeholder` | If site exists, linked to site detail |
| Domain | `domain_name` | Plain text or "—" |
| Hosting | `hosting_final_price` | Currency/mo or "Client Hosted" |
| Maintenance | `maintenance_final_price` | Currency/mo |
| Monthly Total | `monthly_total` | Currency/mo, bold |
| Actions | edit, link site, delete | Icon buttons |

### Add Keep Item Flow

**Form (inline, not modal):**

| Field | Source | Behavior |
|-------|--------|----------|
| Site | Combobox | Select existing site, "Create New Site", or leave empty |
| Site Name | text input | Shows when no site selected. Placeholder name for the keep |
| Domain | text input | Optional. Primary domain name |
| Client Hosted | checkbox | Default false. When checked, hosting plan fields hide |
| Hosting Plan | `HostingPlanSelect` | Use existing component. Shows when not client-hosted |
| Hosting Price | currency input | Pre-filled from plan rate, editable for override |
| Hosting Discount | type + value | Same pattern as charter items |
| Hosting Final | read-only | Auto-calculated |
| Maintenance Plan | `MaintenancePlanSelect` | Use existing component. Always required |
| Maintenance Price | currency input | Pre-filled from plan rate, editable for override |
| Maintenance Discount | type + value | Same pattern |
| Maintenance Final | read-only | Auto-calculated |
| Monthly Total | read-only | hosting_final + maintenance_final |
| Contract Language | BlockNote editor | Optional, behind link |

**"Create New Site" option:** When selected:
- Open existing SiteForm in a modal
- Pre-fill client from Accord
- On success, auto-link to this keep item
- Offer "Create and Open" alongside "Create"

**Client Hosted toggle:** When checked:
- Hide hosting plan, hosting price, hosting discount fields
- Set hosting_final_price to null/0
- Monthly total = maintenance_final_price only

**Plan price override UX:** When user changes the price away from the plan's default rate, show a subtle warning: "Price differs from plan rate ($XX.XX/mo)". This is informational only — overrides are valid for bundle deals and agency discounts.

### Edit Keep Item

Same inline edit pattern. All fields editable.

### Link/Change Site

Same pattern as commission project linking.

---

## Discount Pattern (Shared Component)

All three item types use the same discount UI pattern. Extract as a reusable component: `DiscountFields`.

**Props:**
- `discountType: 'percent' | 'flat' | null`
- `discountValue: number | null`
- `basePrice: number`
- `onChange: (type, value) => void`

**Renders:**
- Select for type: "No Discount", "Percentage", "Flat Amount"
- Number input for value (hidden when "No Discount")
- Inline calculation preview: `$500.00 - 10% = $450.00`

---

## Section Subtotals

Each section shows a subtotal row at the bottom of its table:

- **Charters:** `Monthly: $X,XXX.XX/mo | Contract Total: $XX,XXX.XX`
- **Commissions:** `Total: $X,XXX.XX` (or `$X,XXX.XX + TBD items`)
- **Keeps:** `Monthly: $X,XXX.XX/mo`

---

## Empty States

Each section when empty shows an EmptyState component with:
- **Charters:** "No recurring services yet. Add a charter item to include retainers and subscriptions."
- **Commissions:** "No projects yet. Add a commission item to include one-time projects."
- **Keeps:** "No site services yet. Add a keep to include hosting and maintenance."

Use terminology hook for all labels: `t('charter')`, `t('commission')`, `t('keep')`.

---

## Sort Order / Drag-and-Drop

Each section supports drag-and-drop reordering within its own list (not cross-section). Use existing `@dnd-kit` patterns from the codebase. On drop, PATCH the affected items' `sort_order` values.

**Scope consideration:** If drag-and-drop adds significant complexity, defer it. Manual sort_order (items added in sequence) is acceptable for v1.

---

## React Query Hooks

### New Hooks File: `lib/hooks/use-accord-items.ts`

```typescript
// Charter Items
useAccordCharterItems(accordId)
useAddAccordCharterItem()
useUpdateAccordCharterItem()
useDeleteAccordCharterItem()

// Commission Items
useAccordCommissionItems(accordId)
useAddAccordCommissionItem()
useUpdateAccordCommissionItem()
useDeleteAccordCommissionItem()

// Keep Items
useAccordKeepItems(accordId)
useAddAccordKeepItem()
useUpdateAccordKeepItem()
useDeleteAccordKeepItem()
```

**Pattern:** Follow the exact same mutation/invalidation pattern as the existing `useAddAccordLineItem` etc. hooks in `use-accords.ts`. Invalidate `accordKeys.detail(accordId)` on all mutations.

### Query Keys

Add to `query-keys.ts`:

```typescript
export const accordCharterItemKeys = {
  all: ['accord-charter-items'] as const,
  byAccord: (accordId: string) => [...accordCharterItemKeys.all, accordId] as const,
};

export const accordCommissionItemKeys = {
  all: ['accord-commission-items'] as const,
  byAccord: (accordId: string) => [...accordCommissionItemKeys.all, accordId] as const,
};

export const accordKeepItemKeys = {
  all: ['accord-keep-items'] as const,
  byAccord: (accordId: string) => [...accordKeepItemKeys.all, accordId] as const,
};
```

---

## Type Definitions

Add to `types/entities.ts`:

```typescript
export interface AccordCharterItem {
  id: string;
  accord_id: string;
  ware_id: string;
  ware?: { id: string; name: string; type: WareType };
  name_override: string | null;
  price_tier: string | null;
  base_price: number;
  discount_type: 'percent' | 'flat' | null;
  discount_value: number | null;
  final_price: number;
  billing_period: 'monthly' | 'annually';
  duration_months: number;
  total_contract_value: number;
  charter_id: string | null;
  contract_language_override: string | null;
  addendum_id: string | null;
  sort_order: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccordCommissionItem {
  id: string;
  accord_id: string;
  ware_id: string;
  ware?: { id: string; name: string; type: WareType };
  name_override: string | null;
  estimated_price: number | null;
  project_id: string | null;
  project?: { id: string; name: string; budget_amount: number | null } | null;
  discount_type: 'percent' | 'flat' | null;
  discount_value: number | null;
  final_price: number | null;
  contract_language_override: string | null;
  addendum_id: string | null;
  sort_order: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccordKeepItem {
  id: string;
  accord_id: string;
  site_id: string | null;
  site?: { id: string; name: string; url: string | null } | null;
  site_name_placeholder: string | null;
  domain_name: string | null;
  hosting_plan_id: string | null;
  hosting_plan?: { id: string; name: string; rate: number } | null;
  maintenance_plan_id: string;
  maintenance_plan?: { id: string; name: string; rate: number } | null;
  hosting_price: number | null;
  hosting_discount_type: 'percent' | 'flat' | null;
  hosting_discount_value: number | null;
  hosting_final_price: number | null;
  maintenance_price: number;
  maintenance_discount_type: 'percent' | 'flat' | null;
  maintenance_discount_value: number | null;
  maintenance_final_price: number;
  monthly_total: number;
  is_client_hosted: boolean;
  contract_language_override: string | null;
  addendum_id: string | null;
  sort_order: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}
```

Update `AccordWithRelations`:

```typescript
export interface AccordWithRelations extends Accord {
  client?: { id: string; name: string; status: string } | null;
  owner?: { id: string; name: string; email: string; avatar_url: string | null };
  charter_items?: AccordCharterItem[];
  commission_items?: AccordCommissionItem[];
  keep_items?: AccordKeepItem[];
  // Computed
  mrr?: number;
  total_project_value?: number | null; // null if any TBD items
  total_contract_value?: number | null;
}
```

Remove: `AccordLineItem` interface and all references.

---

## Formatter Updates

In `lib/api/formatters.ts`:

**Remove:** `formatAccordLineItemResponse`

**Add:**
- `formatAccordCharterItemResponse`
- `formatAccordCommissionItemResponse`
- `formatAccordKeepItemResponse`

**Update `formatAccordResponse`:**
- Remove `line_items` from output
- Add `charter_items`, `commission_items`, `keep_items` arrays
- Add computed `mrr`, `total_project_value`, `total_contract_value`

---

## Component Structure

```
components/domain/accords/
├── AccordForm.tsx              (existing — no changes)
├── AccordCard.tsx              (existing — update to show MRR)
├── accord-items/
│   ├── CharterItemsSection.tsx
│   ├── CharterItemForm.tsx
│   ├── CharterItemRow.tsx
│   ├── CommissionItemsSection.tsx
│   ├── CommissionItemForm.tsx
│   ├── CommissionItemRow.tsx
│   ├── KeepItemsSection.tsx
│   ├── KeepItemForm.tsx
│   ├── KeepItemRow.tsx
│   └── DiscountFields.tsx      (shared discount UI)
```

Each `*Section` component is self-contained: fetches its own data, manages add/edit state, renders table + form.

---

## Page Integration

In `app/(app)/deals/[id]/page.tsx`:

1. Remove the entire existing line items Card (ware combobox, price/qty form, line items table)
2. Remove line item state variables (`selectedWareId`, `lineItemPrice`, `lineItemQuantity`, etc.)
3. Remove `useAddAccordLineItem`, `useUpdateAccordLineItem`, `useDeleteAccordLineItem` imports
4. Add the three new section components in the Overview tab, below lead/client info:

```tsx
{/* Line Items — Three Sections */}
<CharterItemsSection accordId={id} />
<CommissionItemsSection accordId={id} />
<KeepItemsSection accordId={id} />
```

5. Add revenue summary below the header
6. Replace static lead info with inline-editable fields

---

## AccordCard Update (Kanban)

The `AccordCard.tsx` used in the kanban view should show MRR when available:
- Below client name: `MRR: $X,XXX/mo` (or omit if $0)
- Keep the card compact — one line, small text
