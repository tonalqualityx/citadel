# Feature: Zoom Scalability (150-200% Browser Zoom)

## Overview
Comprehensive CSS fixes to ensure the Citadel app remains usable at up to 200% browser zoom for a team member with impaired vision. Findings compiled from a full audit of layout, UI primitives, dashboard, domain screens, and global CSS patterns.

## Batch 1: Critical Layout Fixes (Sidebar, Drawers, Mobile Nav)

These break the entire app at zoom levels above 125%.

### 1a. Sidebar width — responsive collapse
- **File:** `components/layout/Sidebar.tsx:165` — `w-[240px]` fixed
- **File:** `components/layout/Sidebar.tsx:166` — `overflow-hidden` on sidebar flex container clips nav at zoom
- **File:** `app/(app)/layout.tsx:29` — `lg:pl-[240px]` fixed padding
- **Fix:** Use `w-60` (Tailwind rem-based) and add `xl:` breakpoint. At zoomed viewports that trigger `lg` but squeeze content, sidebar should collapse to icon-only mode or use a narrower width. Consider CSS clamp: `w-[clamp(200px, 15vw, 240px)]`. Change `overflow-hidden` to `overflow-y-auto` so nav items remain accessible at zoom.

### 1b. Drawer fixed pixel widths
- **File:** `components/ui/drawer.tsx:64-67` — `w-[300px]`, `w-[400px]`, `w-[500px]`, `w-[600px]`
- **Fix:** Change to `w-[min(90vw,300px)]`, `w-[min(90vw,400px)]`, etc. This ensures drawers never exceed 90% of viewport at any zoom level.

### 1c. Mobile nav drawer width
- **File:** `components/layout/MobileNav.tsx:133` — `w-72` (288px)
- **Fix:** Change to `w-[min(85vw,288px)]`.

### 1d. Sidebar overflow-hidden clipping
- **File:** `components/layout/Sidebar.tsx:166` — `overflow-hidden` on flex container
- **Fix:** Change to `overflow-y-auto` so navigation items scroll instead of being clipped at zoom.

**Estimated scope:** 4 files, ~15 line changes

---

## Batch 2: Modal & Command Palette Fixes

### 2a. Modal max-height viewport unit
- **File:** `components/ui/modal.tsx:42` — `max-h-[85vh]`
- **Fix:** Change to `max-h-[min(85vh,calc(100dvh-2rem))]` to account for zoom-adjusted viewport.

### 2b. Modal max-widths
- **File:** `components/ui/modal.tsx:50-54` — `max-w-sm` through `max-w-xl`
- **Fix:** Wrap each in `min(X, calc(100vw - 2rem))` to prevent viewport overflow at zoom.

### 2c. Command palette sizing
- **File:** `components/layout/CommandPalette.tsx:120` — `pt-[15vh]` top padding
- **File:** `components/layout/CommandPalette.tsx:141` — `max-h-80` results container
- **Fix:** Replace `pt-[15vh]` with `pt-[min(15vh,6rem)]`. Add `max-h-[min(20rem,60vh)]` for results.

**Estimated scope:** 2 files, ~10 line changes

---

## Batch 3: Dashboard Grid Responsive Breakpoints

All dashboard grids jump from `grid-cols-1` directly to `lg:grid-cols-3` with no intermediate `md:` breakpoint. At 150% zoom on a 1024px screen, content is cramped.

### Files to modify:
- `components/domain/dashboard/admin-overlook.tsx:236` — add `md:grid-cols-2`
- `components/domain/dashboard/pm-overlook.tsx:249` — add `md:grid-cols-2`
- `components/domain/dashboard/tech-overlook.tsx:223` — add `md:grid-cols-2`
- `app/(app)/tasks/page.tsx:188` — stats grid, add `sm:grid-cols-2`
- `app/(app)/tasks/[id]/page.tsx:528` — 5-col stats, change to `sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5`
- `app/(app)/tasks/[id]/page.tsx:617` — content+sidebar, add `md:grid-cols-2`
- `app/(app)/projects/page.tsx:211` — stats grid, add `sm:grid-cols-2`
- `app/(app)/projects/[id]/page.tsx:516` — stats grid, add `sm:grid-cols-2`
- `app/(app)/sops/[id]/page.tsx:436` — 5-col grid, add intermediate breakpoints
- `app/(app)/clients/page.tsx:305` — stats grid, add `sm:grid-cols-2`

**Fix pattern:** Add `sm:grid-cols-2` or `md:grid-cols-2` as intermediate steps. For 5-col grids, use `sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5`.

**Estimated scope:** 10 files, ~10 line changes

---

## Batch 4: Data Table & Task List Scroll Wrappers

### 4a. Task list grid — no horizontal scroll
- **File:** `components/ui/task-list.tsx:209` — dynamic `gridTemplateColumns` with inline style
- **Fix:** Wrap in `overflow-x-auto` container. Add `min-w-[800px]` to the grid itself so it scrolls instead of clipping.

### 4b. Data table — no scroll wrapper
- **File:** `components/ui/data-table.tsx:74-75` — `<table className="w-full">`
- **Fix:** Wrap `<table>` in `<div className="overflow-x-auto">`.

### 4c. Task list column fixed widths
- **File:** `components/ui/task-list-columns.tsx` — `120px`, `100px`, `160px`, `140px` widths
- **Fix:** Convert to rem-based: `7.5rem`, `6.25rem`, `10rem`, `8.75rem`. These scale with browser zoom.

### 4d. Charter list table
- **File:** `components/domain/charters/CharterList.tsx:44` — table without scroll wrapper
- **Fix:** Wrap in `overflow-x-auto`.

**Estimated scope:** 4 files, ~20 line changes

---

## Batch 5: Truncation + Tooltip Coverage

Many components use `truncate` or `line-clamp-2` without any tooltip, making content inaccessible at zoom.

### Files to add `title` attributes or Tooltip wrappers:
- `components/domain/dashboard/task-quick-list.tsx:97-104` — task titles
- `components/domain/dashboard/project-quick-list.tsx:65` — project names
- `components/domain/charters/CharterKanban.tsx:292` — assignee name (already has `title`, good)
- `components/domain/charters/UsageTracker.tsx:242,290` — task links in breakdown
- `components/domain/charters/CharterList.tsx` — charter names, client names in table cells

**Fix pattern:** Add `title={fullText}` attribute to any element with `truncate` class.

**Estimated scope:** 5 files, ~10 line changes

---

## Batch 6: Focus Target Meter Zoom Fixes

- **File:** `components/domain/dashboard/focus-target-meter.tsx`
  - Lines 120, 170 — Dense horizontal flex without responsive stacking. **Fix:** Add `flex-wrap` and `min-w-0` on children.
  - Line 255 — Estimate labels `text-xs` too small at zoom. **Fix:** Change to `text-sm`.
  - Lines 211-246 — Progress bar `h-4` with overflow-hidden clips capacity marker. **Fix:** Change to `h-5` or `h-6`, add `overflow-visible` with `clip-path` fallback.
  - Line 154 — Hours input `w-14` too narrow. **Fix:** Change to `w-16`.

**Estimated scope:** 1 file, ~8 line changes

---

## Batch 7: Header & Navigation Polish

- **File:** `components/layout/Header.tsx:70` — Search button `max-w-sm` crowds at zoom. **Fix:** `max-w-[min(24rem,50vw)]`.
- **File:** `components/layout/Header.tsx:115` — User menu dropdown `w-48` clips at zoom. **Fix:** `w-[min(12rem,calc(100vw-4rem))]`.

**Estimated scope:** 1 file, ~4 line changes

---

## Batch 8: Minor Polish (Low Priority)

### 8a. Viewport meta tag
- **File:** `app/layout.tsx` — ensure `<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=yes" />` is present. (Next.js may handle this via metadata export.)

### 8b. Global CSS scrollbar
- **File:** `app/globals.css:244` — scrollbar `width: 4px`. Change to `width: 0.25rem`.

### 8c. Small fixed font sizes
- `components/ui/badge.tsx:18` — `text-[10px]`. Change to `text-[0.625rem]` (same but rem-based).
- `components/ui/pill.tsx:33` — same fix.
- `components/ui/avatar.tsx:14` — same fix.

### 8d. Kanban min-heights
- `components/domain/charters/CharterKanban.tsx:193,217` — `min-h-[300px]`, `min-h-[200px]`. Change to `min-h-[18rem]`, `min-h-[12rem]`.

### 8e. Toast max-width
- `components/ui/toast.tsx` — add `max-w-[min(24rem,calc(100vw-2rem))]` to prevent overflow on small screens at zoom.

### 8f. Inline-edit select dropdowns — z-index and fixed widths
- `components/ui/inline-edit/project-select.tsx:90` — `fixed z-[9999] w-72`
- `components/ui/inline-edit/client-select.tsx:97` — `fixed z-[9999] w-64`
- `components/ui/inline-edit/site-select.tsx:106` — `fixed z-[9999] w-72`
- `components/ui/inline-edit/sop-multi-select.tsx:136` — `fixed z-[9999]`
- **Fix:** Lower z-index to `z-50` (matches modal layer). Cap widths with `min(18rem, calc(100vw - 2rem))`.

### 8g. Loading state min-heights
11 files use `min-h-[400px]` for loading spinners. These create forced vertical space at zoom.
- `app/(app)/loading.tsx:3`, `app/(app)/billing/page.tsx:30`, `app/(app)/clients/[id]/page.tsx:80`, `app/(app)/projects/[id]/page.tsx:406`, and 7 others.
- **Fix:** Change to `min-h-[25rem]` (rem-based, scales with zoom).

### 8h. Collapsible overflow-hidden
- `components/ui/collapsible.tsx` — multiple `overflow-hidden` instances
- **Fix:** Use `overflow-clip` (modern CSS) which prevents scroll but doesn't create a new stacking context, or switch to `overflow-y-auto` where content needs to be visible.

**Estimated scope:** ~15 files, ~25 line changes

---

## Files to Create
None.

## Files to Modify (Complete List)
- [ ] `components/layout/Sidebar.tsx` — responsive width
- [ ] `app/(app)/layout.tsx` — responsive sidebar padding
- [ ] `components/ui/drawer.tsx` — viewport-capped widths
- [ ] `components/layout/MobileNav.tsx` — viewport-capped width
- [ ] `components/ui/modal.tsx` — viewport-safe max-height/width
- [ ] `components/layout/CommandPalette.tsx` — zoom-safe padding/height
- [ ] `components/domain/dashboard/admin-overlook.tsx` — grid breakpoints
- [ ] `components/domain/dashboard/pm-overlook.tsx` — grid breakpoints
- [ ] `components/domain/dashboard/tech-overlook.tsx` — grid breakpoints
- [ ] `app/(app)/tasks/page.tsx` — grid breakpoints
- [ ] `app/(app)/tasks/[id]/page.tsx` — grid breakpoints
- [ ] `app/(app)/projects/page.tsx` — grid breakpoints
- [ ] `app/(app)/projects/[id]/page.tsx` — grid breakpoints
- [ ] `app/(app)/sops/[id]/page.tsx` — grid breakpoints
- [ ] `app/(app)/clients/page.tsx` — grid breakpoints
- [ ] `components/ui/task-list.tsx` — scroll wrapper
- [ ] `components/ui/data-table.tsx` — scroll wrapper
- [ ] `components/ui/task-list-columns.tsx` — rem-based widths
- [ ] `components/domain/charters/CharterList.tsx` — scroll wrapper + tooltips
- [ ] `components/domain/dashboard/task-quick-list.tsx` — tooltips
- [ ] `components/domain/dashboard/project-quick-list.tsx` — tooltips
- [ ] `components/domain/charters/UsageTracker.tsx` — tooltips
- [ ] `components/domain/dashboard/focus-target-meter.tsx` — zoom fixes
- [ ] `components/layout/Header.tsx` — zoom-safe widths
- [ ] `app/layout.tsx` — viewport meta
- [ ] `app/globals.css` — rem scrollbar
- [ ] `components/ui/badge.tsx` — rem font size
- [ ] `components/ui/pill.tsx` — rem font size
- [ ] `components/ui/avatar.tsx` — rem font size
- [ ] `components/domain/charters/CharterKanban.tsx` — rem min-heights
- [ ] `components/ui/inline-edit/project-select.tsx` — z-index + width cap
- [ ] `components/ui/inline-edit/client-select.tsx` — z-index + width cap
- [ ] `components/ui/inline-edit/site-select.tsx` — z-index + width cap
- [ ] `components/ui/inline-edit/sop-multi-select.tsx` — z-index
- [ ] `components/ui/collapsible.tsx` — overflow-hidden to overflow-clip
- [ ] `app/(app)/loading.tsx` — rem min-height
- [ ] `app/(app)/billing/page.tsx` — rem min-height
- [ ] `app/(app)/clients/[id]/page.tsx` — rem min-height
- [ ] `app/(app)/projects/[id]/page.tsx` — rem min-height (loading)

## Tests to Update
None expected — these are CSS-only changes that don't affect component behavior or API contracts.

## Tests to Write
None — CSS scalability is verified by visual inspection, not unit tests. Recommend manual testing at 100%, 150%, and 200% zoom after implementation.

## Verification Checklist
- [ ] Sidebar collapses or narrows gracefully at 150%+ zoom
- [ ] All drawers stay within viewport at 200% zoom
- [ ] Modals don't overflow viewport at 150% zoom
- [ ] Dashboard grids stack smoothly through zoom levels
- [ ] Task list and data tables scroll horizontally instead of clipping
- [ ] All truncated text has title/tooltip for full content
- [ ] Focus target meter remains readable at 200% zoom
- [ ] TypeScript compiles without errors
- [ ] No visual regressions at 100% zoom (verify default experience unchanged)
