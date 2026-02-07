# Component Library Guide

Detailed reference for UI components, CSS variables, and task list column helpers.

---

## Component Library Usage (REQUIRED)

### The Rule
**ALWAYS use components from `/components/ui/` - NEVER use raw Tailwind for styling that components already handle.**

### Why This Matters
- Rogue styling breaks when themes change
- Raw Tailwind colors (like `bg-amber-50`) don't respect dark/dim modes
- Components use CSS variables (`var(--warning)`, `var(--border)`) that adapt to themes
- Consistency across the app

### Available Components

Check `/components/ui/` before styling anything:

| Component | Use For |
|-----------|---------|
| `Card`, `CardHeader`, `CardTitle`, `CardContent` | Content containers |
| `Badge` | Status indicators, labels (has `variant`: default, success, warning, error, info) |
| `Button` | Actions (has `variant`: primary, secondary, ghost, danger) |
| `Input`, `Select`, `Textarea` | Form fields |
| `Spinner` | Loading states |
| `EmptyState` | No-data placeholders |
| `DataTable` | Tabular data |
| `TaskList` | Task listings with configurable columns |
| `Tooltip` | Hover information |
| `Modal`, `ModalContent`, `ModalHeader`, `ModalBody` | Dialogs |

### CSS Variables to Use

When you must use Tailwind classes, use these CSS variable-based classes:

| Instead of | Use |
|------------|-----|
| `bg-white`, `bg-gray-50` | `bg-surface`, `bg-surface-alt`, `bg-surface-2` |
| `text-gray-900`, `text-black` | `text-text-main` |
| `text-gray-500`, `text-gray-600` | `text-text-sub` |
| `border-gray-200` | `border-border`, `border-border-warm` |
| `text-amber-600`, warning colors | `Badge variant="warning"` |
| `text-green-600`, success colors | `Badge variant="success"` |

### Before Adding New Styles

1. Check if a component exists in `/components/ui/`
2. Check if the component has a `variant` prop for what you need
3. If styling manually, use CSS variable-based classes from `globals.css`
4. Never use raw color values like `amber-200`, `green-500`, etc.

---

## Task List Column Helpers

Use the column helpers from `/components/ui/task-list-columns.tsx`:

| Column | Purpose | Options |
|--------|---------|---------|
| `titleColumn()` | Task name | `{ editable, showProject }` |
| `statusColumn()` | Status badge/select | `{ editable }` |
| `priorityColumn()` | Priority badge/select | `{ editable }` |
| `assigneeColumn()` | User avatar + name | `{ editable }` |
| `rangedEstimateColumn()` | Time range + progress | None |
| `batteryColumn()` | Battery impact | `{ editable }` |
| `energyColumn()` | Energy estimate | `{ editable }` |
| `mysteryColumn()` | Mystery factor | `{ editable }` |
| `dueDateColumn()` | Due date | `{ editable }` |
| `focusColumn()` | Focus checkbox | `{ onToggleFocus }` |
| `approveColumn()` | Approve button | `{ onApprove }` |
