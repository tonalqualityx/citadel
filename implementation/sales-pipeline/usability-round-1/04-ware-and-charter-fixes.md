# Ware & Charter Usability Fixes

## Overview

Several usability issues across Wares and Charters: Wares need dedicated detail screens instead of modals, contract language and descriptions need BlockNote editors, and the Charter form has a raw UUID input for client selection.

---

## Problem 1: Wares Have No Detail Screen

### Current State
Wares are managed entirely through a modal form (`WareForm.tsx`). The form has:
- Name (text)
- Type (dropdown: Commission/Charter)
- Base Price (number)
- Charter Billing Period (conditional dropdown)
- Description (textarea)
- Contract Language (textarea)
- Active toggle

This is too constrained for writing contract language, configuring default schedules, and managing complex pricing tiers.

### Fix
**Create a dedicated Ware detail page with full editing capabilities.**

#### New Route: `/deals/wares/[id]`

**Page layout:**

**Header:**
- Ware name (editable inline)
- Type badge (Commission/Charter)
- Active toggle
- Back to Wares list

**Sections (vertically stacked, not tabbed — Wares aren't complex enough for tabs):**

##### Basic Info
- Name (editable)
- Type (Commission/Charter — editable, with warning if changing type on a Ware that's in use)
- Base Price (editable)
- Charter Billing Period (conditional, for Charter type only)

##### Description (BlockNote editor)
- Rich text description of the service offering
- Full-width editor with adequate height

##### Contract Language (BlockNote editor)
- Default contract clause for this Ware
- Full-width editor — this is legal text and needs room
- This content gets pulled into generated contracts

##### Pricing Tiers (structured form)
- JSON-backed but presented as a structured UI
- Add/remove/edit tiers (e.g., "Small: $X", "Medium: $Y", "Large: $Z")
- Each tier: name, price, description
- Optional — not all Wares need tiers

##### Default Schedule (Charter Wares only)
- For Charter-type Wares: configure the default recurring task schedule
- Table of SOPs with cadence selectors (weekly, monthly, quarterly, semi_annually, annually)
- Add/remove SOPs (searchable SOP dropdown)
- This template gets copied to new Charters when this Ware is added

##### Default Recipe (Commission Wares only)
- For Commission-type Wares: select the default project template
- Searchable Recipe/Ritual dropdown
- Preview of what the Recipe includes (phases, task count)

#### Ware Creation Flow
- On the Wares list page, "New Ware" button
- Opens a **minimal creation modal**: Name, Type (required fields only)
- Two buttons: "Create" and "Create & Open"
  - **Create**: saves and closes modal, returns to list
  - **Create & Open**: saves and navigates to `/deals/wares/[id]` for full editing
- This lets users quickly stub out a Ware or immediately dive into configuring it

#### Wares List Changes
- Table rows link to detail page instead of opening modal
- Remove edit-via-modal behavior
- Keep the inline active toggle on the list (quick action)

---

## Problem 2: BlockNote for All Contract/Content Fields

### Current State
Several fields that should be rich text are plain textareas:
- WareForm: `contract_language` — textarea
- WareForm: `description` — textarea
- AddendumForm: `contract_content` — textarea
- AddendumForm: `description` — textarea
- AddendumForm: `changes` — JSON textarea
- AddendumForm: `pricing_snapshot` — JSON textarea

### Fix

**Replace with BlockNote editor everywhere content needs to be readable:**

| Field | Current | Should Be |
|-------|---------|-----------|
| Ware description | textarea | BlockNote |
| Ware contract_language | textarea | BlockNote |
| Addendum contract_content | textarea | BlockNote |
| Addendum description | textarea | BlockNote |
| Contract content | textarea/HTML | BlockNote |

**Storage:** All BlockNote content stored as JSON string (consistent with proposals, MSA, SOPs, task descriptions).

**Addendum changes and pricing_snapshot** should remain JSON but get a proper structured UI instead of raw JSON textarea. Changes should show a formatted list of what's being added/removed/modified. Pricing snapshot should show the same pricing table used elsewhere.

---

## Problem 3: Charter Form UUID Input

### Current State
The CharterForm has a `Client ID` text input that expects a raw UUID string:
```
<Input label="Client ID" ... />
```

This violates basic usability — no user should need to find and paste a UUID.

### Fix
**Replace with searchable client Combobox.**

```tsx
<Combobox
  label={t('client')}
  options={clientOptions}
  value={selectedClientId}
  onChange={setSelectedClientId}
  placeholder={`Select a ${t('client').toLowerCase()}...`}
/>
```

Where `clientOptions` comes from `useClients()` mapped to `{ value: id, label: name }`.

### Audit: All Entity Selectors

Check ALL forms across the Parley/Charter/Accord system for raw ID inputs. Every entity selector should use a searchable Combobox:

| Entity Being Selected | Used In | Should Be |
|----------------------|---------|-----------|
| Client | CharterForm | Combobox (searchable) |
| Client | AccordForm (if applicable) | Combobox (searchable) |
| Ware | AccordLineItem form | Combobox ✅ (already done) |
| SOP | CharterScheduledTask form | Combobox (searchable) |
| User | Meeting attendees | Combobox (searchable) |
| User | Automation rule specific_user | Combobox ✅ (already done) |
| Recipe | Ware default recipe | Combobox (searchable) |
| Project | CharterCommission link | Combobox (searchable, scoped to client) |
| Accord | Meeting association | Combobox (searchable, scoped to client) |

**Rule:** If a form field selects an entity by ID, it MUST use a searchable Combobox. No exceptions. Raw UUID/ID inputs are never acceptable.

---

## Problem 4: Charter Detail — Additional Fixes

### Accord Link
If a Charter was created from an Accord, the Charter detail should show a link to the originating Accord. Verify this is working — the `accord_id` FK exists but the UI may not display it as a clickable link.

### Ware Display
Charter Wares tab should show the Ware name as a link to the Ware detail page (once it exists). Currently it may just show the name as text.

### Commission Display
Charter Commissions tab should show the Commission/Project name as a link to the project detail page. Verify this links correctly.

---

## Implementation Checklist

### Files to Create
- [ ] `/app/(app)/deals/wares/[id]/page.tsx` — Ware detail page
- [ ] Pricing tiers editor component (structured UI for JSON field)
- [ ] Default schedule editor component (SOP + cadence table)

### Files to Modify
- [ ] `/app/(app)/deals/wares/page.tsx` — Link rows to detail page, update "New Ware" to modal with "Create & Open"
- [ ] `/components/domain/wares/WareForm.tsx` — Simplify to creation-only modal (Name + Type), remove full editing
- [ ] `/components/domain/charters/CharterForm.tsx` — Replace Client ID input with Combobox
- [ ] `/components/domain/addendums/AddendumForm.tsx` — Replace textareas with BlockNote editors, structured changes UI
- [ ] Any other forms identified in the entity selector audit

### API Changes
- [ ] Verify Ware API returns all fields needed for detail page (contract_language, default_schedule, recipe)
- [ ] Verify Ware PATCH supports BlockNote JSON for description and contract_language
- [ ] Verify Contract API stores/returns BlockNote JSON format

### Tests
- [ ] Ware detail page renders all sections
- [ ] Ware creation modal works with "Create & Open"
- [ ] Charter form uses Combobox for client selection
- [ ] BlockNote editors save and load correctly for all converted fields
- [ ] All existing tests pass
