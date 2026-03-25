# Sales Pipeline — Screens & User Flows

## Overview

This document defines every new screen, component, and user flow for the Parley system. It covers internal Citadel screens (kanban, detail views, settings) and the client-facing portal.

---

## Navigation Changes

### Sidebar Structure (Updated)

```
Overlook (Dashboard)
Timekeeper (Time)

Foundry:
  Commissions (was Pacts/Projects)
  Patrons (Clients)
  Charters (NEW — Retainers)
  Sites
  Domains
  Quests (Tasks)
  Tools

Parley (NEW — Sales):
  Accords (Deals — Kanban view)
  Wares (Product catalog)

Grimoire:
  Runes (SOPs)
  Rituals (Templates/Recipes)

Settings / Guild
Admin (PM/Admin only)
  Billing
  Team
  Functions
  Parley Settings (NEW)
  ...
```

**Access control:** Parley section visible to PM and Admin roles only.

---

## Parley Screens

### 1. Accords Kanban — `/deals` (Parley > Accords)

**Purpose:** Primary sales pipeline view. Drag-and-drop kanban board.

**Columns:**
| Column | Status | Description |
|--------|--------|-------------|
| Lead | `lead` | New opportunities |
| Meeting | `meeting` | Meeting scheduled/held |
| Proposal | `proposal` | Proposal drafted/sent, awaiting response |
| Contract | `contract` | Contract sent, awaiting signature |
| Signed | `signed` | Signed, pending payment confirmation |
| Active | `active` | Fully live — payment confirmed, work underway |

**Kanban Card (Accord card):**
- Accord name
- Client/lead name
- Total value (sum of line items)
- Owner avatar
- Days at current status (visual indicator — green < threshold, amber near threshold, red over)
- Number of line items (e.g., "3 Wares")
- Badge if proposal/contract pending client action

**Card actions (right-click or dropdown):**
- View details
- Move to next stage
- Mark as Lost (with optional reason prompt)
- Reopen (from Lost only)

**Filters:**
- Owner
- Date range (created, entered current status)
- Has client vs lead-only

**Additional views:**
- Lost deals section (collapsed, below the kanban or as a filtered view)
- List view toggle (table format with sortable columns)

---

### 2. Accord Detail — `/deals/[id]`

**Purpose:** Full detail view for a single Accord.

**Header:**
- Accord name (editable inline)
- Status badge with forward/backward navigation arrows
- Client name (linked) or lead info
- Owner (editable, user select)
- Total value
- Created date / days in pipeline

**Tabs:**

#### Overview Tab
- **Lead/Client Info:** If client linked, show client summary. If lead, show editable lead fields (name, business, email, phone, notes).
- **Line Items Table:** Wares on this Accord with pricing. Add/remove/edit line items. Each row shows: Ware name, type (Commission/Charter badge), price, billing cycle, quantity.
- **Timeline/Activity:** Chronological log of all Accord activity (status changes, proposals sent, client responses, etc.). Uses existing ActivityLog pattern.

#### Meeting Tab (visible when status >= meeting)
- Meeting date (date picker)
- Attendees (multi-select from Citadel users)
- Transcript link (URL input)
- Recording link (URL input)
- Meeting notes (rich text editor)

#### Proposal Tab (visible when status >= proposal)
- **Proposal versions list** with status badges
- **Active proposal** displayed with:
  - Content preview (rendered HTML)
  - Pricing summary (from snapshot)
  - Status: Draft / Sent / Accepted / Rejected / Changes Requested
  - Client note (if changes requested or rejected)
- **Actions:**
  - Create new proposal (version increments)
  - Edit draft proposal (rich text / HTML editor)
  - Preview as client (opens portal view in new tab)
  - Send to client (generates portal token, sends email, moves proposal to `sent`)
  - Mark as accepted/rejected manually (fallback if client doesn't use portal)

#### Contract Tab (visible when status >= contract)
- **Contract content** (auto-generated, editable before sending)
- **MSA status:** Shows if client has signed current MSA. Warning if not.
- **Contract versions list** with status badges
- **Actions:**
  - Regenerate contract (from current line items + Ware language)
  - Edit contract before sending
  - Preview as client
  - Send to client
  - Mark as signed manually (fallback)

#### Addendums Tab (visible when Accord is active)
- List of all addendums with status badges
- Create new addendum button
- Addendum detail: title, description, line item changes, contract language
- Preview / send / mark as accepted flow (mirrors proposal flow)

#### Commissions & Charters Tab (visible when Accord status >= signed)
- **Commissions section:** Projects created from this Accord. Status, progress, links to project detail.
- **Charters section:** Retainers created from this Accord. Status, active Wares, links to Charter detail.
- **Payment status:** Payment confirmed toggle (manual for now)

---

### 3. New Accord — `/deals/new`

**Purpose:** Create a new Accord.

**Form:**
- Name (required)
- Associate with existing Client (optional search/select) OR enter lead info:
  - Lead name
  - Lead business name
  - Lead email
  - Lead phone
- Owner (defaults to current user)
- Initial status: `lead` (default) or `meeting` if meeting already scheduled
- Add initial Wares (optional — can add line items later)

---

### 4. Wares Catalog — `/deals/wares` (Parley > Wares)

**Purpose:** Manage the product/service catalog.

**List view:**
- Table with: Name, Type (Commission/Charter), Billing Cycle, Base Price, Active status
- Search by name
- Filter by type, active status
- Sort by name, price, sort_order

**Actions:**
- Create new Ware
- Edit (inline or modal)
- Deactivate/activate
- Reorder (drag-and-drop)

---

### 5. Ware Detail / Editor — Modal or `/deals/wares/[id]`

**Form fields:**
- Name
- Description (rich text)
- Type: Commission or Charter (affects downstream behavior)
- Billing cycle: One-time, Monthly, Annually
- Base price
- Price tiers (JSON editor or structured sub-form)
- Contract language (HTML/rich text editor)
- Default recipe/template (for Commission Wares — select from existing Recipes)
- Default recurring schedule (for Charter Wares — list of SOPs with cadence selectors)
- Active toggle

---

### 6. Parley Settings — `/admin/parley-settings`

**Purpose:** Admin screen for managing sales pipeline configuration.

**Sections:**

#### Automation Rules
- Table of all SalesAutomationRules
- Each rule shows: name, trigger type, trigger status, threshold, action, assignee rule, active toggle
- Create/edit rule (modal):
  - Name
  - Trigger type: Status Change or Time at Status
  - Which status
  - From status (for status change triggers)
  - Time threshold in hours (for time-based)
  - Task template: title, description, priority, energy estimate
  - Assignee rule: Accord owner / Meeting attendees / Specific user

#### MSA Management
- Current MSA version badge
- Version history list
- Create new MSA version:
  - Version number
  - Content (rich text / HTML editor)
  - Effective date
  - Change summary
  - Set as current toggle
- View which clients have signed which version

#### Default Contract Settings
- Default payment terms text
- Default contract footer/boilerplate
- Email templates for proposal/contract sending

---

## Foundry Screen Changes

### 7. Charters List — `/charters` (Foundry > Charters)

**Purpose:** List all retainers across clients.

**Table columns:**
- Charter name (linked to detail)
- Client name (linked)
- Status badge (active/paused/cancelled)
- Active Wares count
- Budget hours / period
- Current period usage (progress bar)
- Start date

**Filters:**
- Status (active, paused, cancelled)
- Client
- Search by name

---

### 8. Charter Detail — `/charters/[id]`

**Purpose:** Full view of an ongoing retainer.

**Header:**
- Charter name
- Client (linked)
- Status badge with actions (pause, cancel, reactivate)
- Billing period type (monthly/annually)
- Budget hours and rate
- Current period usage progress bar
- Link to originating Accord (if exists)

**Tabs:**

#### Current Period Tab
- **Obligations:** Which Wares are active, what's expected this period
- **Recurring Tasks:** Tasks generated for this period with status
- **One-Off Tasks:** Ad-hoc tasks added to this Charter
- **Related Commissions:** Active Commissions drawing from this Charter's budget, with allocated hours and usage
- **Period usage summary:** Actual hours logged, scheduled remaining, projected total

#### Schedule Tab
- **Recurring task schedules:** Table of CharterScheduledTasks
  - SOP name, cadence, associated Ware, active toggle
  - Add/remove/edit schedules
- **Generation history:** Log of when tasks were generated (CharterGenerationLog)

#### Wares Tab
- Active Wares on this Charter with current pricing
- Inactive/removed Wares (historical)
- Links to source Accord/Addendum that added each Ware

#### Archive Tab
- Completed Commissions that drew from this Charter
- Past period summaries (hours used, tasks completed)

#### Contract Tab
- Link to the originating Contract
- Links to any Addendums that modified this Charter
- Current terms summary

---

### 9. Client Detail Changes — `/clients/[id]`

**New tabs on client detail:**

#### Accords Tab
- All Accords for this client (active pipeline + completed + lost)
- Quick status view, total values, dates
- Link to Accord detail

#### Charters Tab
- All Charters for this client (active + paused + cancelled)
- Budget, usage summary per Charter
- Link to Charter detail

---

### 10. Commission (Project) Changes

**Project detail modifications:**
- If `scope_locked = true`, show a locked badge in header
- When adding a task to a scope-locked project, intercept with modal:
  - **Title:** "This Commission is under contract"
  - **Body:** "Adding tasks to a scope-locked project may require a contract addendum."
  - **Options:**
    - "Prepare Addendum" — opens addendum creation flow on the related Accord, pre-populated with this task. Allows adding more tasks before sending.
    - "Override (Minor Change)" — prompts for reason, creates override Addendum record, allows task creation
    - "Cancel" — don't add the task
- Link to originating Accord in project header (if exists)

---

## Client Portal Screens

All portal screens use a minimal, clean design. No Citadel chrome. Branded with Indelible identity. Token-secured, no login required.

### 11. Proposal View — `/portal/proposal/[token]`

**Layout:**
- Indelible logo / branding header
- Proposal title (Accord name)
- "Prepared for [Client/Lead Name]" subtitle
- Proposal content (rendered HTML — clean, sectioned, readable)
- Pricing summary table (from snapshot)
- Total value

**Actions (bottom):**
- **Accept Proposal** button → confirmation modal → triggers contract generation, loads contract view
- **Request Changes** button → opens text area for note → submits → notifies Accord owner
- **Reject** button → optional reason text area → submits → notifies Accord owner

**After acceptance:** Page transitions to show the contract (either inline or redirect to contract URL).

**Footer:**
- "This proposal was prepared by Indelible Inc."
- Date prepared
- Version indicator

---

### 12. Contract View — `/portal/contract/[token]`

**Layout:**
- Indelible logo / branding header
- Contract title
- **MSA Section** (if client hasn't signed current MSA):
  - MSA content rendered
  - "I agree to the Master Services Agreement" checkbox
- **Contract content** (rendered HTML — terms generated from Wares + contract language)
- Pricing table
- Payment terms

**Actions (bottom):**
- Signer name input (pre-filled if known)
- Signer email input (pre-filled if known)
- **Sign Contract** button → confirmation modal ("By clicking Sign, you agree to the terms above. This constitutes a legally binding agreement.")
- Checkbox: "I have read and agree to the terms"

**After signing:**
- Confirmation message: "Contract signed successfully. A copy has been emailed to [email]."
- PDF download link
- Email sent immediately with contract copy

**If MSA needs signing:** MSA section appears first. Client must check MSA agreement before the contract sign button becomes active.

---

### 13. Addendum View — `/portal/addendum/[token]`

**Layout:**
- Similar to contract view
- Shows: what's changing, why, pricing impact
- Original contract reference
- New/modified line items highlighted

**Actions:**
- Accept / Request Changes / Reject (same pattern as proposal)
- After acceptance: confirmation + email

---

### 14. MSA Standalone View — `/portal/msa/[token]`

**Purpose:** For signing MSA independent of a deal (e.g., when MSA is updated and existing clients need to re-sign).

**Layout:**
- MSA content
- Signer info
- Sign button
- Confirmation + email

---

### 15. Portal Onboarding — `/portal/onboard/[token]`

**Purpose:** When a lead (no client record) signs a contract, collect business information.

**Appears after contract signing, before confirmation.**

**Form:**
- Business name (pre-filled from lead info if available)
- Business address
- Primary contact name (pre-filled)
- Primary contact email (pre-filled)
- Primary contact phone (pre-filled)
- Billing contact (if different)
- Billing email

**On submit:** Creates Client record in Citadel, links Accord to new Client.

---

## User Flows

### Flow 1: New Lead → Signed Deal (Happy Path)

```
1. Mike creates new Accord in Parley
   → Enters lead name, business, email
   → Adds Wares with pricing
   → Status: Lead

2. Mike schedules a meeting
   → Moves Accord to Meeting
   → Sets meeting date, assigns attendees
   → (Time-based rule: if no transcript 24h after meeting, create task)

3. After meeting, transcript uploaded
   → Mike uses Claude Code + proposal skill with transcript
   → Generates HTML proposal content
   → Adds proposal content to Accord in Citadel
   → Previews proposal

4. Mike sends proposal
   → Click "Send" → system generates portal token, sends email
   → Status: Proposal (proposal status: sent)

5. Client views proposal in portal
   → Reads content, reviews pricing
   → Clicks "Accept Proposal"

6. System auto-generates contract
   → Accord moves to Contract status
   → Contract page loads immediately for client
   → Client sees MSA (if not signed) + contract terms

7. Client signs contract
   → Provides name, email, checks agreements
   → If lead (no client): onboarding form appears, collects business info, creates Client
   → Contract marked signed
   → Email confirmation sent with contract copy

8. Mike confirms payment
   → (Manual for now: toggle in Accord detail)
   → Accord moves to Active
   → Commissions created/linked, scope locked
   → Charters created with recurring schedules
   → Retainer task generation begins on next cron cycle
```

### Flow 2: Proposal Changes Requested

```
1. Client views proposal, clicks "Request Changes"
2. Client enters note explaining what they want changed
3. Accord owner gets notification with client's note
4. Mike revises line items / scope as needed
5. Mike creates new proposal version (v2)
6. Mike sends updated proposal
7. Client receives new link, reviews v2
8. Client accepts → flow continues to contract
```

### Flow 3: Addendum to Active Accord

```
1. Mike adds a task to a scope-locked Commission
2. System prompts: "Prepare Addendum or Override?"
3. Mike chooses "Prepare Addendum"
4. Addendum creation opens on the Accord
   → Mike adds the task(s) being added
   → Mike can add more tasks to the same addendum
   → Pricing impact shown
   → Contract language auto-generated
5. Mike previews and sends addendum
6. Client accepts addendum in portal
7. New tasks are added to the Commission
8. (If addendum includes new Ware for Charter: Charter updated, new schedules activated)
```

### Flow 4: Adding Service to Existing Charter

```
1. Client wants to add Social Media Management to existing SEO retainer
2. Mike creates addendum on the original Accord
3. Adds new Ware (Social Media Charter) as line item
4. Sends addendum to client
5. Client accepts
6. Existing Charter gets new CharterWare added
7. New recurring task schedules activated
8. Budget/pricing updated per addendum terms
```

---

## Email Templates Needed

| Email | Trigger | Recipient | Content |
|-------|---------|-----------|---------|
| Proposal Sent | Proposal status → sent | Client/lead email | "You have a new proposal from Indelible. [View Proposal]" |
| Contract Ready | Accord status → contract | Client/lead email | "Your contract is ready for review. [View Contract]" |
| Contract Signed Confirmation | Contract signed | Client signer email | "Contract signed successfully. [View Contract] [Download PDF]" |
| Addendum Sent | Addendum status → sent | Client email | "You have a contract addendum to review. [View Addendum]" |
| Addendum Accepted Confirmation | Addendum accepted | Client email | "Addendum accepted. [View Details]" |
| MSA Signing Request | Manual trigger or MSA updated | Client email | "Please review and sign the updated Master Services Agreement. [View MSA]" |
| MSA Signed Confirmation | MSA signed | Client email | "MSA signed successfully. [Download PDF]" |
| Proposal Accepted (Internal) | Client accepts proposal | Accord owner | "[Client] accepted the proposal for [Accord]. Contract has been generated." |
| Proposal Rejected (Internal) | Client rejects proposal | Accord owner | "[Client] rejected the proposal. Reason: [reason]" |
| Changes Requested (Internal) | Client requests changes | Accord owner | "[Client] requested changes to the proposal. Note: [note]" |
| Contract Signed (Internal) | Client signs contract | Accord owner | "[Client] signed the contract for [Accord]." |
| Addendum Response (Internal) | Client responds to addendum | Accord owner | "[Client] [accepted/rejected/requested changes] the addendum." |
