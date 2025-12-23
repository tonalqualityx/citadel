# Indelible App: List Views & Filters Wireframes
## Phase 2.4 Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** ðŸŸ¡ In Progress

---

## Overview

List views are where users spend most of their timeâ€”scanning, filtering, and deciding what to work on next. This document defines the patterns and specifics for all major list views in Indelible.

---

## List Views Inventory

| Entity | Primary Users | Key Features | Priority |
|--------|---------------|--------------|----------|
| **Quests** | Techs, PMs | Heavy filtering, grouping, energy visibility | P1 |
| **Pacts** | PMs, Admins | Status filtering, progress indicators | P2 |
| **Patrons** | PMs, Admins | Status, retainer indicator, counts | P3 |
| **Sites** | PMs, Admins | Hosting status, patron grouping | P4 |
| **Runes (SOPs)** | All | Category/Function filtering, search | P5 |
| **Team Members** | Admins | Role, capacity, assignments | P6 |
| **Tools** | All | Category filtering, quick-open | P7 |
| **Scrolls (Recipes)** | PMs, Admins | Simpler list, less frequent | P8 |

---

## Shared List Patterns

### Standard List Layout

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  PageHeader                                                                     â”‚
â”‚  [Icon] [Title]                                          [+ Primary Action]    â”‚
â”‚     [Summary stats]                                                             â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  VIEW TABS (optional saved filter presets)                                      â”‚
â”‚  [All]    [Preset 1]    [Preset 2]    [Preset 3]                               â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  FILTER BAR                                                                     â”‚
â”‚  [ðŸ” Search...]                                                                 â”‚
â”‚  [Filter 1 â–¼]  [Filter 2 â–¼]  [Filter 3 â–¼]       Group by: [Option â–¼]           â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  ACTIVE FILTERS (visible when filters applied)                                  â”‚
â”‚  Filter: Value âœ•  |  Filter: Value âœ•  |  [Clear all]                          â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  LIST CONTENT                                                                   â”‚
â”‚  (grouped or ungrouped rows/cards)                                             â”‚
â”‚                                                                                 â”‚
â”‚  [Pagination or infinite scroll]                                               â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### Filter Bar Components

| Component | Behavior |
|-----------|----------|
| **Search** | Instant filter as you type, searches name/title |
| **Filter Dropdowns** | Multi-select where appropriate, single-select for simple filters |
| **Group By** | Changes list organization (status, phase, assignee, none) |
| **View Toggle** | Switches between display modes (rows, cards) |
| **Active Filters** | Pill display of current filters with âœ• to remove |
| **Clear All** | Removes all active filters |

---

### Filter Dropdown Behavior

**Single-select filters:**
- Click to open dropdown
- Select one option
- Dropdown closes
- Filter applied immediately

**Multi-select filters:**
- Click to open dropdown
- Checkboxes for each option
- Select multiple options
- Click outside or "Apply" to close
- Filter applied on close

**Filter states:**
- Default: "All" shown
- Filtered: Value(s) shown, subtle highlight
- Hover: Light background

---

### Active Filters Bar

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  Status: In Progress, Blocked âœ•  |  Phase: Design âœ•  |  Clear all             â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

- Light blue-tinted background (#F0F5F8)
- Only visible when at least one filter is active
- Each filter shows as pill: "Label: Value(s)" with âœ•
- Multiple values comma-separated
- "Clear all" resets all filters

---

### List Display Modes

| Mode | Use Case | Best For |
|------|----------|----------|
| **Rows** | Dense data scanning | Quests, Team Members |
| **Cards** | Visual overview | Pacts, Patrons |
| **Compact** | Maximum density | Tools, Runes |

---

### Grouping Behavior

**Group header:**
```
â— Group Name (count)                                        [Collapse â–¼]
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
```

- Status indicator (colored dot)
- Group name
- Count in parentheses
- Collapse/expand toggle
- Divider line below

**Collapsed state:**
```
â— Group Name (count)                                        [Expand â–¶]
```

**Empty groups:** Hidden by default (don't show groups with 0 items)

---

### Pagination vs Infinite Scroll

| Approach | Use When |
|----------|----------|
| **Infinite scroll** | Primary lists (Quests, Pacts) for fluid browsing |
| **Pagination** | Large datasets, need to jump to specific pages |
| **Load more** | Hybridâ€”button to load next batch |

Default: **Infinite scroll** with "load more" fallback.

---

## Quests List View

### Purpose & Context

The Quest list is the primary worklist for the team. Users scan this to decide what to work on, check status, and identify blockers.

**Who uses this:** Techs (daily), PMs (daily), Admins (occasionally)

**Key tasks:**
- Find my next task
- Check what's blocked
- See team workload
- Filter to specific project/phase

---

### Context Variants

| Context | Scope | Filters Available |
|---------|-------|-------------------|
| **Global Quests** | All quests user can see | All filters |
| **My Quests** | Assigned to current user | Status, Phase, Pact |
| **Pact > Quests Tab** | Quests for one pact | Status, Phase, Assignee |
| **Dashboard Widget** | Limited preview | Pre-filtered |

---

### Page Structure

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  PageHeader                                                                     â”‚
â”‚  âš”ï¸ Quests                                                     [+ Add Quest]   â”‚
â”‚     124 quests Â· 18 in progress Â· 3 blocked                                     â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  VIEW TABS                                                                      â”‚
â”‚  [All Quests]    My Quests    Needs Attention    Recently Completed             â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                                                                   â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  FILTER BAR                                                                     â”‚
â”‚  [ðŸ” Search quests...]                                                          â”‚
â”‚                                                                                 â”‚
â”‚  Status: [All â–¼]  Phase: [All â–¼]  Assignee: [All â–¼]  Pact: [All â–¼]             â”‚
â”‚                                                                                 â”‚
â”‚  Group by: [Status â–¼]                                        View: [Rows â–¼]    â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  ACTIVE FILTERS                                                                 â”‚
â”‚  Status: In Progress, Blocked âœ•  |  Phase: Design âœ•  |  [Clear all]           â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  LIST CONTENT                                                                   â”‚
â”‚                                                                                 â”‚
â”‚  â— In Progress (12)                                              Collapse â–¼    â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚  â”‚ âš”ï¸ Homepage Mockup          ðŸ¤ Website Redesign   âš¡3~5  ðŸ‘¤ MH   Dec 20    â”‚ â”‚
â”‚  â”‚ âš”ï¸ Navigation Design        ðŸ¤ Website Redesign   âš¡2~3  ðŸ‘¤ MH   Dec 18    â”‚ â”‚
â”‚  â”‚ âš”ï¸ API Integration          ðŸ¤ App Development    âš¡4~6  ðŸ‘¤ JD   Dec 22    â”‚ â”‚
â”‚  â”‚ ...                                                                        â”‚ â”‚
â”‚                                                                                 â”‚
â”‚  ðŸš« Blocked (3)                                                  Collapse â–¼    â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚  â”‚ âš”ï¸ Content Migration        ðŸ¤ Website Redesign   âš¡2~4  ðŸ‘¤ SJ   Dec 15 âš ï¸ â”‚ â”‚
â”‚  â”‚    â†³ Waiting on: Client content                                            â”‚ â”‚
â”‚  â”‚ ...                                                                        â”‚ â”‚
â”‚                                                                                 â”‚
â”‚  â—‹ Ready (8)                                                     Collapse â–¼    â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚  â”‚ ...                                                                        â”‚ â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### PageHeader

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  âš”ï¸  Quests                                                    [+ Add Quest]   â”‚
â”‚      124 quests Â· 18 in progress Â· 3 blocked                                    â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Meta line stats:**

| Stat | Display |
|------|---------|
| Total | "X quests" |
| In Progress | "X in progress" |
| Blocked | "X blocked" (amber color as attention indicator) |

**Primary action:** `[+ Add Quest]`

---

### View Tabs

```
[All Quests]    My Quests    Needs Attention    Recently Completed
```

| Tab | Filter Applied | Description |
|-----|----------------|-------------|
| All Quests | None | Everything visible to user |
| My Quests | Assignee = current user | Personal worklist |
| Needs Attention | Blocked, In Review, or Overdue | Items requiring action |
| Recently Completed | Done in last 7 days | Recent wins |

These are **saved filter presets**â€”clicking applies the filter without page navigation.

---

### Filter Bar

#### Row 1: Search

```
[ðŸ” Search quests...]
```

- Full-width text input
- Magnifying glass icon (left)
- Placeholder: "Search quests..."
- Searches quest name
- Instant filtering as you type
- Shows result count when active: "12 results"

#### Row 2: Filter Dropdowns

```
Status: [All â–¼]  Phase: [All â–¼]  Assignee: [All â–¼]  Pact: [All â–¼]
```

| Filter | Type | Options |
|--------|------|---------|
| Status | Multi-select | Planning, Ready, In Progress, Blocked, In Review, Done |
| Phase | Multi-select | Setup, Content & Strategy, Design, Build, Launch |
| Assignee | Multi-select | Team members + "Unassigned" |
| Pact | Multi-select | Active pacts + "No Pact" (standalone quests) |

#### Row 3: Display Controls

```
Group by: [Status â–¼]                                        View: [Rows â–¼]
```

| Control | Options | Default |
|---------|---------|---------|
| Group by | Status, Phase, Assignee, Pact, None | Status |
| View | Rows, Cards | Rows |

---

### Quest Row

```
â”‚ âš”ï¸ Homepage Mockup          ðŸ¤ Website Redesign   âš¡3~5  ðŸ‘¤ MH   Dec 20    â”‚
```

#### Column Layout

| Column | Content | Width | Alignment |
|--------|---------|-------|-----------|
| Quest | Icon + name (link) | ~40% flex | Left |
| Pact | ðŸ¤ + pact name (link) | ~25% | Left |
| Energy | EnergyBadge | 60px fixed | Center |
| Assignee | Avatar + initials | 48px fixed | Center |
| Due Date | Date | 80px fixed | Right |

#### Row Specifications

| Property | Value |
|----------|-------|
| Height | 48px |
| Padding | 12px horizontal |
| Font size | 15px (quest name), 14px (others) |
| Background | Alternating white / #FAFAFA |
| Hover | Light blue tint (#F5F9FC) |
| Border | 1px bottom, #E8E5E0 |

---

### Quest Row States

#### Normal Row

```
â”‚ âš”ï¸ Homepage Mockup          ðŸ¤ Website Redesign   âš¡3~5  ðŸ‘¤ MH   Dec 20    â”‚
```

Standard display, no special treatment.

#### Blocked Row

```
â”ƒ âš”ï¸ Content Migration        ðŸ¤ Website Redesign   âš¡2~4  ðŸ‘¤ SJ   Dec 15 âš ï¸ â”‚
â”ƒ    â†³ Waiting on: Client content                                            â”‚
```

- 3px amber left border
- Second line shows blocker reason
- Indented with "â†³" prefix
- Blocker text in muted color

#### Overdue Row

```
â”‚ âš”ï¸ Navigation Design        ðŸ¤ Website Redesign   âš¡2~3  ðŸ‘¤ MH   Dec 18 âš ï¸ â”‚
```

- Due date in amber color
- Warning icon (âš ï¸) after date
- No border change (unless also blocked)

#### Done Row

```
â”‚ âš”ï¸ Homepage Mockup          ðŸ¤ Website Redesign   âš¡3~5  ðŸ‘¤ MH   âœ“ Dec 20  â”‚
```

- Text slightly muted
- Checkmark before completion date
- Optional: subtle strikethrough on name

---

### Grouping Headers

```
â— In Progress (12)                                              Collapse â–¼
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
```

#### Group Header Layout

| Element | Position | Description |
|---------|----------|-------------|
| Status dot | Left | 8px colored circle |
| Group name | After dot | Semibold text |
| Count | After name | "(X)" in parentheses |
| Collapse toggle | Right | "Collapse â–¼" / "Expand â–¶" |
| Divider | Below | Thin border line |

#### Header Specifications

| Property | Value |
|----------|-------|
| Height | 40px |
| Background | #F8F7F5 |
| Font | 14px semibold |
| Padding | 12px horizontal |

---

### Status Dot Colors

| Status | Color | Style |
|--------|-------|-------|
| Planning | #888888 (gray) | Filled |
| Ready | #5B8FB9 (blue) | Outline only |
| In Progress | #5B8FB9 (blue) | Filled |
| Blocked | #C4A24D (amber) | Filled |
| In Review | #8B7EC7 (purple) | Filled |
| Done | #6B9B7A (green) | Filled |

---

### Empty States

| Scenario | Message | Action |
|----------|---------|--------|
| No quests at all | "No quests yet." | [Create your first quest] |
| No results from filter | "No quests match your filters." | [Clear filters] |
| No quests in tab | "No quests need attention right now. ðŸŽ‰" | â€” |

---

### Responsive Behavior

#### Desktop (>1024px)

Full table layout as documented.

#### Tablet (768-1024px)

- Pact column hidden (visible in expanded row or tooltip)
- Filters collapse to "Filters (2)" button â†’ opens panel
- Group headers remain visible

#### Mobile (<768px)

- Switch to card layout
- Each quest as a card showing all info stacked
- Filters in slide-out drawer
- Search remains visible at top

---

## Pacts List View

### Purpose & Context

The Pacts list shows all projects. PMs use this to track overall project health and status.

**Who uses this:** PMs (primary), Admins, Techs (occasionally)

**Key tasks:**
- See all active projects
- Check project health/progress
- Find projects by client or status
- Quick access to project details

---

### Page Structure

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  PageHeader                                                                     â”‚
â”‚  ðŸ¤ Pacts                                                       [+ Add Pact]   â”‚
â”‚     24 pacts Â· 8 active Â· 2 at risk                                             â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  VIEW TABS                                                                      â”‚
â”‚  [All Pacts]    Active    At Risk    Completed                                  â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                                                                    â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  FILTER BAR                                                                     â”‚
â”‚  [ðŸ” Search pacts...]                                                           â”‚
â”‚                                                                                 â”‚
â”‚  Status: [All â–¼]  Patron: [All â–¼]  PM: [All â–¼]          Group by: [Status â–¼]   â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  LIST CONTENT (Card Layout)                                                     â”‚
â”‚                                                                                 â”‚
â”‚  â— In Progress (5)                                                              â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚                                                                                 â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”               â”‚
â”‚  â”‚ ðŸ¤ Website Redesign         â”‚  â”‚ ðŸ¤ SEO Optimization         â”‚               â”‚
â”‚  â”‚    In Progress              â”‚  â”‚    In Progress              â”‚               â”‚
â”‚  â”‚ ðŸ§‘â€ðŸš€ Acme Corp Â· ðŸ° Main Web  â”‚  â”‚ ðŸ§‘â€ðŸš€ Acme Corp Â· ðŸ° Main Web  â”‚               â”‚
â”‚  â”‚ ðŸ‘¤ Sarah Jenkins            â”‚  â”‚ ðŸ‘¤ Sarah Jenkins            â”‚               â”‚
â”‚  â”‚ â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘  9/12 75%  â”‚  â”‚ â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘  3/8 38%   â”‚               â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜               â”‚
â”‚                                                                                 â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”               â”‚
â”‚  â”‚ ðŸ¤ App Development          â”‚  â”‚ ðŸ¤ Brand Refresh            â”‚               â”‚
â”‚  â”‚    In Progress   âš ï¸ At Risk â”‚  â”‚    In Progress              â”‚               â”‚
â”‚  â”‚ ðŸ§‘â€ðŸš€ TechStart Â· ðŸ° Mobile    â”‚  â”‚ ðŸ§‘â€ðŸš€ Coffee Co Â· ðŸ° Main      â”‚               â”‚
â”‚  â”‚ ðŸ‘¤ Mike Hansen              â”‚  â”‚ ðŸ‘¤ Jane Doe                 â”‚               â”‚
â”‚  â”‚ â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘  4/10 40%   â”‚  â”‚ â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘  12/14 86%  â”‚               â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜               â”‚
â”‚                                                                                 â”‚
â”‚  â—‹ Ready (2)                                                                    â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚  â”‚ ...                                                                        â”‚ â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### PageHeader

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  ðŸ¤  Pacts                                                      [+ Add Pact]   â”‚
â”‚      24 pacts Â· 8 active Â· 2 at risk                                            â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Meta line stats:**

| Stat | Display |
|------|---------|
| Total | "X pacts" |
| Active | "X active" |
| At Risk | "X at risk" (amber, attention indicator) |

---

### View Tabs

```
[All Pacts]    Active    At Risk    Completed
```

| Tab | Filter Applied |
|-----|----------------|
| All Pacts | None |
| Active | Status = In Progress, Ready, In Review |
| At Risk | Health = At Risk or Off Track |
| Completed | Status = Done |

---

### Filter Bar

```
[ðŸ” Search pacts...]

Status: [All â–¼]  Patron: [All â–¼]  PM: [All â–¼]          Group by: [Status â–¼]
```

| Filter | Type | Options |
|--------|------|---------|
| Status | Multi-select | Quote, Queue, Ready, In Progress, Review, Suspended, Done, Abandoned |
| Patron | Multi-select | All patrons |
| PM | Multi-select | All PMs |
| Group by | Single-select | Status, Patron, PM, None |

---

### Pact Card

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  ðŸ¤ Website Redesign                                            â”‚
â”‚     In Progress   âš ï¸ At Risk                                    â”‚
â”‚                                                                 â”‚
â”‚  ðŸ§‘â€ðŸš€ Acme Corp Â· ðŸ° Main Website                                 â”‚
â”‚  ðŸ‘¤ Sarah Jenkins (PM)                                          â”‚
â”‚                                                                 â”‚
â”‚  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘  9/12 quests Â· 75%               â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Card Elements

| Element | Description |
|---------|-------------|
| Pact name | Title with ðŸ¤ icon, link to detail |
| Status | StatusChip |
| Health | "âš ï¸ At Risk" badge if applicable |
| Patron | ðŸ§‘â€ðŸš€ + name, link |
| Site | ðŸ° + name, link |
| PM | ðŸ‘¤ + avatar + name |
| Progress | Progress bar + "X/Y quests Â· Z%" |

#### Card Specifications

| Property | Value |
|----------|-------|
| Width | 280px (desktop), responsive |
| Padding | 16px |
| Background | White |
| Border radius | 8px |
| Shadow | Subtle |
| Gap between cards | 16px |

#### Card Grid

- Desktop: 3-4 cards per row
- Tablet: 2 cards per row
- Mobile: 1 card per row (full width)

---

### Health Indicators on Cards

| Health | Display |
|--------|---------|
| On Track | No indicator (default) |
| At Risk | "âš ï¸ At Risk" badge in amber |
| Off Track | "âš ï¸ Off Track" badge in amber (darker) |

---

## Patrons List View

### Purpose & Context

Top-level client list. Shows all clients with their status, site counts, and active work.

**Who uses this:** PMs, Admins

---

### Page Structure

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  PageHeader                                                                     â”‚
â”‚  ðŸ§‘â€ðŸš€ Patrons                                                   [+ Add Patron]   â”‚
â”‚     18 patrons Â· 12 active Â· 3 with retainers                                   â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  FILTER BAR                                                                     â”‚
â”‚  [ðŸ” Search patrons...]                                                         â”‚
â”‚                                                                                 â”‚
â”‚  Status: [All â–¼]  Type: [All â–¼]                          Group by: [None â–¼]    â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  LIST CONTENT (Card Layout)                                                     â”‚
â”‚                                                                                 â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”               â”‚
â”‚  â”‚ ðŸ§‘â€ðŸš€ Acme Corp               â”‚  â”‚ ðŸ§‘â€ðŸš€ TechStart Inc            â”‚               â”‚
â”‚  â”‚    â— Active                 â”‚  â”‚    â— Active                 â”‚               â”‚
â”‚  â”‚ 3 sites Â· 2 active pacts    â”‚  â”‚ 1 site Â· 1 active pact      â”‚               â”‚
â”‚  â”‚ $150/hr                     â”‚  â”‚ $175/hr Â· ðŸ”„ 10h retainer   â”‚               â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜               â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### Filter Bar

| Filter | Type | Options |
|--------|------|---------|
| Status | Multi-select | Active, Inactive, Never Again, Delinquent |
| Type | Single-select | All, Direct, White-Label |
| Group by | Single-select | Status, None |

---

### Patron Card

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  ðŸ§‘â€ðŸš€ Acme Corp                                                  â”‚
â”‚     â— Active                                                    â”‚
â”‚                                                                 â”‚
â”‚  3 sites Â· 2 active pacts                                       â”‚
â”‚  $150/hr Â· ðŸ”„ 10h retainer                                      â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Card Elements

| Element | Description |
|---------|-------------|
| Patron name | Title with ðŸ§‘â€ðŸš€ icon |
| Status | StatusChip (Active, Inactive, etc.) |
| Counts | "X sites Â· Y active pacts" |
| Rate | "$X/hr" |
| Retainer | "ðŸ”„ Xh retainer" (if applicable) |

---

## Sites List View

### Purpose & Context

Reference list for all websites. Shows hosting, maintenance, and patron info.

---

### Page Structure

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  PageHeader                                                                     â”‚
â”‚  ðŸ° Sites                                                        [+ Add Site]  â”‚
â”‚     32 sites Â· 24 hosted by us Â· 8 client-hosted                                â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  FILTER BAR                                                                     â”‚
â”‚  [ðŸ” Search sites...]                                                           â”‚
â”‚                                                                                 â”‚
â”‚  Hosting: [All â–¼]  Platform: [All â–¼]  Patron: [All â–¼]    Group by: [Patron â–¼]  â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  LIST CONTENT (Row Layout)                                                      â”‚
â”‚                                                                                 â”‚
â”‚  ðŸ§‘â€ðŸš€ Acme Corp (3 sites)                                                        â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚  â”‚ ðŸ° Main Website      acmecorp.com      Indelible   WPMU Dev   Pro Plan    â”‚ â”‚
â”‚  â”‚ ðŸ° Blog              blog.acmecorp.com Indelible   WPMU Dev   Basic       â”‚ â”‚
â”‚  â”‚ ðŸ° Product Landing   products.acme.com Client      â€”          â€”           â”‚ â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### Filter Bar

| Filter | Type | Options |
|--------|------|---------|
| Hosting | Single-select | All, Indelible, Client |
| Platform | Multi-select | WPMU Dev, Cloudways, GoDaddy, Other |
| Patron | Multi-select | All patrons |
| Group by | Single-select | Patron, Hosting, None |

---

### Site Row

| Column | Content | Width |
|--------|---------|-------|
| Site | ðŸ° + name | ~25% |
| Domain | Primary domain | ~25% |
| Hosting | Indelible / Client | ~15% |
| Platform | WPMU Dev, etc. | ~15% |
| Maintenance | Plan name or "â€”" | ~20% |

---

## Runes (SOPs) List View

### Purpose & Context

SOP library. All team members access this for procedures and templates.

---

### Page Structure

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  PageHeader                                                                     â”‚
â”‚  ðŸ“œ Runes                                                        [+ Add Rune]  â”‚
â”‚     45 runes                                                                    â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  FILTER BAR                                                                     â”‚
â”‚  [ðŸ” Search runes...]                                                           â”‚
â”‚                                                                                 â”‚
â”‚  Category: [All â–¼]  Function: [All â–¼]  Tool: [All â–¼]     Group by: [Cat â–¼]     â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  LIST CONTENT (Compact Cards)                                                   â”‚
â”‚                                                                                 â”‚
â”‚  ðŸŽ¨ Design (12)                                                                 â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚ ðŸ“œ Mockup - Page                       â”‚  â”‚ ðŸ“œ Mockup - Component          â”‚ â”‚
â”‚  â”‚    Create page mockup in Figma         â”‚  â”‚    Create component mockup     â”‚ â”‚
â”‚  â”‚    ðŸ‘¤ Designer II Â· ðŸ”§ Figma           â”‚  â”‚    ðŸ‘¤ Designer II Â· ðŸ”§ Figma   â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### Filter Bar

| Filter | Type | Options |
|--------|------|---------|
| Category | Multi-select | Design, Development, PM, Content, etc. |
| Function | Multi-select | All functions (Designer II, Developer III, etc.) |
| Tool | Multi-select | All tools |
| Group by | Single-select | Category, Function, None |

---

### Rune Card

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  ðŸ“œ Mockup - Page                                               â”‚
â”‚     Create page mockup in Figma                                 â”‚
â”‚     ðŸ‘¤ Designer II Â· ðŸ”§ Figma                                   â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Description |
|---------|-------------|
| Rune name | Title with ðŸ“œ icon |
| Description | Brief description |
| Function | Role that performs this |
| Tool | Primary tool used |

---

## Team Members List View

### Purpose & Context

Admin view for team management, capacity planning, and assignments.

---

### Page Structure

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  PageHeader                                                                     â”‚
â”‚  ðŸ‘¥ Guild Members                                            [+ Invite Member]  â”‚
â”‚     8 members Â· 6 active                                                        â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  FILTER BAR                                                                     â”‚
â”‚  [ðŸ” Search members...]                                                         â”‚
â”‚                                                                                 â”‚
â”‚  Status: [All â–¼]  Role: [All â–¼]  Function: [All â–¼]                             â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  LIST CONTENT (Row Layout)                                                      â”‚
â”‚                                                                                 â”‚
â”‚  â”‚ ðŸ‘¤ Sarah Jenkins    PM          sarah@indelible.com    5 pacts   â— Active â”‚ â”‚
â”‚  â”‚ ðŸ‘¤ Mike Hansen      Designer II mike@indelible.com     8 quests  â— Active â”‚ â”‚
â”‚  â”‚ ðŸ‘¤ Jane Doe         Developer   jane@indelible.com     6 quests  â— Active â”‚ â”‚
â”‚  â”‚ ðŸ‘¤ Tom Wilson       Designer I  tom@indelible.com      3 quests  â— Active â”‚ â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### Member Row

| Column | Content |
|--------|---------|
| Avatar + Name | Photo/initials + full name |
| Function | Primary role |
| Email | Contact email |
| Workload | "X pacts" or "X quests" active |
| Status | Active, Inactive, Invited |

---

## Tools List View

### Purpose & Context

Simple reference list of all software tools used by the agency.

---

### Page Structure

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                 â”‚
â”‚  PageHeader                                                                     â”‚
â”‚  ðŸ”§ Tools                                                        [+ Add Tool]  â”‚
â”‚     24 tools                                                                    â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  FILTER BAR                                                                     â”‚
â”‚  [ðŸ” Search tools...]                                                           â”‚
â”‚                                                                                 â”‚
â”‚  Category: [All â–¼]                                       Group by: [Cat â–¼]     â”‚
â”‚                                                                                 â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                                 â”‚
â”‚  LIST CONTENT (Compact Grid)                                                    â”‚
â”‚                                                                                 â”‚
â”‚  ðŸŽ¨ Design (4)                                                                  â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”        â”‚
â”‚  â”‚ ðŸ”§ Figma     â”‚  â”‚ ðŸ”§ Adobe CC  â”‚  â”‚ ðŸ”§ Canva     â”‚  â”‚ ðŸ”§ Loom      â”‚        â”‚
â”‚  â”‚    Design    â”‚  â”‚    Design    â”‚  â”‚    Design    â”‚  â”‚    Design    â”‚        â”‚
â”‚  â”‚   [Open â†—]   â”‚  â”‚   [Open â†—]   â”‚  â”‚   [Open â†—]   â”‚  â”‚   [Open â†—]   â”‚        â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜        â”‚
â”‚                                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### Tool Card (Compact)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                      â”‚
â”‚  ðŸ”§ Figma            â”‚
â”‚     Design           â”‚
â”‚    [Open â†—]          â”‚
â”‚                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Description |
|---------|-------------|
| Tool name | Title with ðŸ”§ icon |
| Category | Category label |
| Action | "Open â†—" link to tool URL |

---

## Empty States Summary

| List | Empty State | Action |
|------|-------------|--------|
| Quests | "No quests yet." | [Create your first quest] |
| Quests (filtered) | "No quests match your filters." | [Clear filters] |
| Pacts | "No pacts yet." | [Create your first pact] |
| Patrons | "No patrons yet." | [Add your first patron] |
| Sites | "No sites yet." | [Add your first site] |
| Runes | "No runes yet." | [Create your first rune] |
| Team Members | "No team members yet." | [Invite your first member] |
| Tools | "No tools yet." | [Add your first tool] |

---

## ND Optimizations Applied

| Principle | Implementation |
|-----------|----------------|
| **Reduce decision fatigue** | View tabs provide pre-filtered starting points |
| **Visual status scanning** | Colored dots and badges for quick status recognition |
| **Attention focusing** | Blocked/overdue items visually distinct |
| **Reduce hunting** | Grouping keeps related items together |
| **Context preservation** | Pact/Patron shown on quest rows |
| **Clear next actions** | "Needs Attention" tab surfaces actionable items |
| **Consistent patterns** | All lists use same filter bar structure |
| **No anxiety colors** | Amber for attention, never red |

---

## Components Used

| Component | Usage |
|-----------|-------|
| PageHeader | Title, stats, primary action |
| ViewTabs | Saved filter presets |
| FilterBar | Search + dropdowns |
| ActiveFilters | Current filter display |
| QuestRow | Quest list items |
| PactCard | Pact list items |
| PatronCard | Patron list items |
| SiteRow | Site list items |
| RuneCard | SOP list items |
| MemberRow | Team member list items |
| ToolCard | Tool list items |
| GroupHeader | Collapsible group headers |
| EmptyState | No results messaging |
| StatusChip | Status display |
| EnergyBadge | Energy estimates |
| Avatar | User display |
| ProgressBar | Progress indicators |

---

## Related Documents

- `indelible-wireframes-quest-detail.md` â€” Quest detail view
- `indelible-wireframes-pact-patron-detail.md` â€” Pact and Patron detail views
- `indelible-wireframes-site-domain-tool-detail.md` â€” Site, Domain, Tool detail views
- `indelible-component-library.md` â€” Component specifications
- `indelible-wireframes-dashboards.md` â€” Dashboard wireframes
