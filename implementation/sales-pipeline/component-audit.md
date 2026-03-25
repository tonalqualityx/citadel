# Sales Pipeline — Component Audit

**Date:** 2026-03-18

---

## 1. UI Components (`/app/components/ui/`)

### Core Components

| Component | File | Key Features |
|-----------|------|--------------|
| **Button** | `button.tsx` | Variants: primary, secondary, ghost, destructive, link. Sizes: default, sm, lg, icon. CVA-based. |
| **Card** | `card.tsx` | Compound: Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter. CSS variable theming. |
| **Badge** | `badge.tsx` | Variants: default, success, warning, error, info, purple. Sizes: sm, default, lg. |
| **Pill** | `pill.tsx` | Colors: green, lime, amber, orange, red, muted. High-contrast design. |
| **Modal** | `modal.tsx` | Radix UI Dialog. Sizes: sm, md, lg, xl. Compound structure with fade/zoom transitions. |
| **Drawer** | `drawer.tsx` | Radix UI, non-modal. Sides: left, right. Sizes: sm (300px), md (400px), lg (500px), xl (600px). |
| **Tabs** | `tabs.tsx` | Radix UI. Components: Tabs, TabsList, TabsTrigger, TabsContent. |

### Data Display

| Component | File | Key Features |
|-----------|------|--------------|
| **DataTable** | `data-table.tsx` | Generic typed, pagination, selection (checkboxes + select-all), row click, custom cell rendering, loading/empty states. |
| **TaskList** | `task-list.tsx` | Generic with grouping, selectable rows, group selection, collapsible groups, grid-based layout, load more support. |
| **EmptyState** | `empty-state.tsx` | Icon, title, description, action. Centered layout. |
| **Avatar** | `avatar.tsx` | Sizes: xs-xl. Image or hash-based initials. 8 distinct colors. |
| **Skeleton** | `skeleton.tsx` | Shimmer loading placeholder. |
| **Spinner** | `spinner.tsx` | Sizes: sm, md, lg. Animated border spinner. |
| **Tooltip** | `tooltip.tsx` | Hover-based. Sides: top, bottom, left, right. Fixed positioning. |

### Form Components

| Component | File | Key Features |
|-----------|------|--------------|
| **Input** | `input.tsx` | Label, error support. Date input special handling. |
| **Textarea** | `textarea.tsx` | Label, resizable, focus states. |
| **Select** | `select.tsx` | Native select with styling. Label, placeholder, options. |
| **Combobox** | `combobox.tsx` | Standard (searchable dropdown), InlineCombobox (pill-styled), CreatableCombobox (custom values). Keyboard nav, search filtering. |
| **MultiSelect** | `multi-select.tsx` | Checkbox-based, shows count when >2 selected. Clear all, toggle. |
| **Checkbox** | `checkbox.tsx` | Button-based with icon. Disabled state. |
| **Switch** | `switch.tsx` | Toggle with animation. Disabled state. |
| **SearchInput** | `search-input.tsx` | Search icon, debounce support. |
| **IconPicker** | `icon-picker.tsx` | Grid display from lucide-react. |

### Inline Editing (`/inline-edit/`)

| Component | File | Pattern |
|-----------|------|---------|
| **InlineText** | `inline-text.tsx` | Click-to-edit. Types: text, email, tel, url, number. Save on Enter/blur, cancel on Escape. |
| **InlineDate** | `inline-date.tsx` | Calendar icon + formatted date. Native date input. ISO conversion. |
| **InlineSelect** | `inline-select.tsx` | Dropdown trigger with chevron. Clear option. Custom value rendering. |
| **InlineTextarea** | `inline-textarea.tsx` | Multiline click-to-edit. |
| **Domain-specific** | Various | ProjectSelect, ClientSelect, SiteSelect, HostingPlanSelect, MaintenancePlanSelect, DNSProviderSelect, SOPMultiSelect. |

### Rich Text Editor

| Component | File | Key Features |
|-----------|------|--------------|
| **RichTextEditor** | `rich-text-editor.tsx` | BlockNote 0.45.0 with Mantine theming. TipTap auto-migration. File upload (/api/uploads). Dark mode. Read-only mode (RichTextRenderer). Plain text extraction (getBlockNotePlainText). Output: BlockNote JSON. |

---

## 2. Domain Components (`/app/components/domain/`)

### Task Components (`tasks/`)

| Component | Description |
|-----------|-------------|
| **TaskForm** | Full task form: title, description, status, priority, project, client, phase, assignee, function, SOP, energy estimate, mystery factor, battery impact, due date, notes, billing fields. react-hook-form + Zod. |
| **TaskDependencies** | Blocking/blocked-by relationship management. |
| **CommentSection** | Inline comments with threading. |
| **TimeEntriesSection** | Time tracking interface. |
| **ReviewSection** | Task review/approval workflow. |
| **TaskRequirements** | Requirement item management. |
| **TaskPeekDrawer** | Side drawer for quick task viewing/editing. |
| **BulkEditTasksModal** | Multi-select task editing. |

### Project Components (`projects/`)

| Component | Description |
|-----------|-------------|
| **ProjectForm** | Full project form: name, description, status, type (project/retainer/internal), billing_type, client, site, dates, budget, retainer flag, notes. |
| **ProjectHealthBadge** | Health statuses: healthy, at-risk, critical. Score percentage. Tooltip with indicators. ProjectHealthDot for lists. |
| **MilestoneList/Form** | Milestone display and management. |
| **ProjectTeamTab** | Team member management. |
| **ProjectTimeTab** | Time tracking for project. |
| **ProjectWorkloadTab** | Workload visualization. |
| **ProjectBriefTab** | Project brief/overview. |
| **SortableProjectPhase** | dnd-kit drag-and-drop phases. Grip handle. |
| **SortableProjectTask** | dnd-kit dragging tasks within phases. |

### Client Components (`clients/`)

| Component | Description |
|-----------|-------------|
| **ClientForm** | Client creation/editing. |
| **BulkEditClientsModal** | Multi-select client editing. |
| **AddSiteModal** | Quick site addition. |
| **ClientSitesTab** | Sites for client. |
| **ClientRetainerTab** | Full retainer usage dashboard with month navigation (~300 lines). |
| **ClientActivityTab** | Activity log for client. |

### Activity

| Component | Description |
|-----------|-------------|
| **ActivityFeed** | Entity activities with icons. Actions: created, updated, deleted, status_changed, assigned, unassigned, completed, commented. User avatar + timestamp. |

---

## 3. dnd-kit Patterns

**Installed Packages:**
- `@dnd-kit/core` ^6.3.1
- `@dnd-kit/sortable` ^10.0.0
- `@dnd-kit/utilities` ^3.2.2

**Current Usage:**
1. **WizardStep3Sitemap** — Full sortable list: DndContext + closestCenter + SortableContext + verticalListSortingStrategy + PointerSensor + KeyboardSensor
2. **SortableProjectPhase** — Phase-level sorting with grip handle
3. **SortableProjectTask** — Task-level sorting within phases, opacity change during drag

**Pattern:** useSortable hook → CSS.Transform.toString() → GripVertical icon → opacity 0.5 during drag

**Current Limitation:** Only vertical sorting within a single list. Kanban board will need cross-container drag-and-drop.

---

## 4. Gap Analysis for Sales Pipeline

### Reusable As-Is

| Component | Sales Pipeline Use |
|-----------|-------------------|
| DataTable | Wares list, line items table, deal list view, proposal/contract version lists |
| Modal/Drawer | Accord creation, Ware editor, scope change prompt, addendum creation |
| Card | Deal cards (with customization), Charter summary cards |
| Badge/Pill | Accord status, Proposal status, Contract status, Charter status |
| Avatar | Owner display on deal cards |
| Combobox | Client/contact selection, Ware selection for line items |
| RichTextEditor | Proposal content, contract language, meeting notes, Ware descriptions |
| InlineText/Date/Select | Quick field updates on Accord detail (name, owner, meeting date) |
| ActivityFeed | Accord activity timeline |
| Tabs | Accord detail tabs, Charter detail tabs |
| Checkbox/Switch | Payment confirmed toggle, active toggles |
| SearchInput | Wares search, Accords search |
| EmptyState | Empty pipeline stages, no proposals yet |

### Need Extension

| Component | Extension Needed |
|-----------|-----------------|
| DataTable | Add/remove rows for line items, inline price/quantity editing |
| ActivityFeed | Deal-specific action types (proposal_sent, contract_signed, payment_confirmed) |
| ProjectHealthBadge pattern | Adapt for deal health (days at status thresholds) |

### New Components Needed

| Component | Purpose |
|-----------|---------|
| **AccordKanbanBoard** | Multi-column kanban with cross-container dnd-kit drag-and-drop |
| **AccordCard** | Compact deal card for kanban columns (name, client, value, owner, days-at-status indicator) |
| **AccordStatusBar** | Visual status progression with forward/backward navigation |
| **LineItemsEditor** | Editable line items table: add Ware, set price/quantity, remove, reorder |
| **DaysAtStatusIndicator** | Green/amber/red indicator based on time thresholds |
| **PortalLayout** | Clean, branded layout for client-facing portal (no app chrome) |
| **ContractViewer** | Rendered HTML contract display |
| **SignatureForm** | Signer name, email, agreement checkbox, sign button |
| **PricingSummaryTable** | Read-only pricing display for proposals/contracts |
| **AccordForm** | New accord creation: name, client/lead info, owner, initial Wares |
| **WareForm** | Ware editor: name, type, pricing, contract language, schedule/recipe |
| **CharterForm** | Charter creation/editing |
| **ScheduleBuilder** | SOP selector + cadence picker for Charter recurring tasks |

### dnd-kit Enhancement Required

For the kanban board, need to implement **cross-container drag-and-drop**:
- Multiple SortableContext containers (one per status column)
- Container-level DndContext with `collisionDetection: pointerWithin` or `closestCenter`
- `onDragOver` for cross-container moves (not just `onDragEnd`)
- Visual drop indicators between columns
- Status transition validation on drop (prevent invalid moves)
