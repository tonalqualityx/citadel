# Indelible App: Component Library
## Phase 2.7 Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** âœ… Complete

---

## Overview

This document defines the complete component library for Indelible. All components follow neurodivergent-optimized design principles and use consistent design tokens. This library serves as the single source of truth for UI implementation.

---

## Design Tokens (Foundation)

Before components, these foundational tokens are referenced throughout.

### Color Tokens

#### Light Mode (Calm)

```css
--bg-primary: #FAF9F7;        /* warm off-white */
--bg-secondary: #F5F3EF;      /* subtle depth */
--bg-elevated: #FFFFFF;       /* cards, modals */
--text-primary: #2D2D2D;      /* dark gray, NOT black */
--text-secondary: #666666;
--text-muted: #888888;
--accent: #5B8FB9;            /* desaturated blue */
--accent-hover: #4A7FA8;
--accent-subtle: #EBF2F7;     /* accent at 10% */
--border: #E2DED6;            /* soft warm gray */
--focus-ring: #5B8FB9;
--success: #6B9B7A;           /* muted green */
--success-subtle: #EDF4EF;
--warning: #C4A24D;           /* muted gold - NOT red */
--warning-subtle: #FBF7ED;
```

#### Dark Mode (Calm)

```css
--bg-primary: #1E1E1E;        /* not pure black */
--bg-secondary: #252525;
--bg-elevated: #2A2A2A;
--text-primary: #E8E8E8;      /* off-white */
--text-secondary: #A0A0A0;
--text-muted: #707070;
--accent: #7BAFD4;            /* lightened for dark bg */
--accent-hover: #8BBFE4;
--accent-subtle: #2A3540;     /* accent at 15% */
--border: #3A3A3A;
--focus-ring: #7BAFD4;
--success: #7DAF8C;
--success-subtle: #1E2A20;
--warning: #D4B95D;
--warning-subtle: #2A2820;
```

### Spacing Scale

```css
--space-1: 4px;    /* tight, inside compact elements */
--space-2: 8px;    /* between related items */
--space-3: 12px;   /* default padding */
--space-4: 16px;   /* between components */
--space-5: 24px;   /* section separation */
--space-6: 32px;   /* major section breaks */
--space-8: 48px;   /* page-level spacing */
```

### Border Radius

```css
--radius-sm: 4px;      /* buttons, inputs, badges */
--radius-md: 8px;      /* cards, dropdowns */
--radius-lg: 12px;     /* modals, large cards */
--radius-full: 9999px; /* pills, avatars */
```

### Shadows

```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);     /* subtle lift */
--shadow-md: 0 2px 8px rgba(0,0,0,0.08);     /* cards, dropdowns */
--shadow-lg: 0 8px 24px rgba(0,0,0,0.12);    /* modals, drawers */
```

### Typography Scale

```css
--text-xs: 12px;    /* labels, captions */
--text-sm: 14px;    /* secondary text, nav items */
--text-base: 16px;  /* body text */
--text-lg: 18px;    /* lead text */
--text-xl: 20px;    /* section headers */
--text-2xl: 24px;   /* page titles */
--text-3xl: 32px;   /* large numbers, stats */
```

### Font Weights

```css
--font-normal: 400;   /* body text */
--font-medium: 500;   /* nav items, labels */
--font-semibold: 600; /* headings, emphasis */
```

### Font Stack

```css
font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

---

## 1. Layout Components

### Card

The primary container for grouped content.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  Card Header (optional)                          Action Link â†’  â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚                                                                 â”‚
â”‚  Card content goes here                                         â”‚
â”‚                                                                 â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Background | `--bg-elevated` |
| Border | 1px `--border` |
| Border radius | `--radius-md` (8px) |
| Shadow | `--shadow-md` |
| Padding | `--space-4` (16px) |

**Variants:**

| Variant | Use Case | Modification |
|---------|----------|--------------|
| **Default** | Standard content container | As specified |
| **Flush** | Card within card, no shadow | No shadow, border only |
| **Interactive** | Clickable card | Hover: slight shadow increase, cursor pointer |
| **Featured** | Highlighted content (What's Next) | Accent left border (3px) |

---

### Section

Groups related content within a page.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  Section Title                                   View all â†’     â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚                                                                 â”‚
â”‚  Section content                                                â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Title | `--text-base`, `--font-semibold` |
| Divider | 1px `--border`, below title |
| Spacing | `--space-3` below title, `--space-5` between sections |
| Action link | `--text-sm`, `--accent` |

---

### PageHeader

Consistent header for all detail and list pages.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                â”‚
â”‚  ðŸ°  Main Website                                         [Edit]  [â‹® More]    â”‚
â”‚      Acme Corp Â· Active Â· Hosted by Indelible                                  â”‚
â”‚                                                                                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Specification |
|---------|---------------|
| Icon | 24px, entity-specific |
| Title | `--text-2xl`, `--font-semibold` |
| Meta line | `--text-sm`, `--text-secondary` |
| Separators | " Â· " between meta items |
| Actions | Right-aligned button group |

---

### Modal

Overlay dialog for focused interactions.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                    â”‚
â”‚  Modal Title                                             [Esc] âœ•   â”‚
â”‚                                                                    â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
â”‚                                                                    â”‚
â”‚  Modal content goes here. Can include forms, confirmations,        â”‚
â”‚  or any focused interaction.                                       â”‚
â”‚                                                                    â”‚
â”‚                                                                    â”‚
â”‚                                                                    â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
â”‚                                                      [Cancel] [Save] â”‚
â”‚                                                                    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Width | 480px (sm), 640px (md), 800px (lg) |
| Max height | 85vh |
| Background | `--bg-elevated` |
| Border radius | `--radius-lg` (12px) |
| Shadow | `--shadow-lg` |
| Backdrop | rgba(0,0,0,0.5) |

**Sizes:**

| Size | Width | Use Case |
|------|-------|----------|
| **sm** | 480px | Confirmations, simple forms |
| **md** | 640px | Standard forms, detail views |
| **lg** | 800px | Complex forms, wizards |

**Behavior:**
- Close on Esc key
- Close on backdrop click (optional, not for destructive actions)
- Focus trapped inside modal
- Show keyboard shortcut hint [Esc]

---

### Drawer

Slide-in panel for contextual content without losing page context.

```
                                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                                    â”‚                                  â”‚
                                    â”‚  Drawer Title              [âœ•]   â”‚
                                    â”‚                                  â”‚
                                    â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
                                    â”‚                                  â”‚
                                    â”‚  Drawer content                  â”‚
                                    â”‚                                  â”‚
                                    â”‚  Can be scrollable               â”‚
                                    â”‚                                  â”‚
                                    â”‚                                  â”‚
                                    â”‚                                  â”‚
                                    â”‚                                  â”‚
                                    â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”‚
                                    â”‚                       [Actions]  â”‚
                                    â”‚                                  â”‚
                                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Width | 400px (sm), 560px (md), 720px (lg) |
| Position | Right side of viewport |
| Background | `--bg-elevated` |
| Shadow | `--shadow-lg` on left edge |

**Use Cases:**
- Quest peek (view without navigating away)
- Quick create forms
- Entity previews

---

## 2. Navigation Components

### Tabs

For switching views within an entity.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                â”‚
â”‚  [Overview]    Domains    Pacts    Notes    Time                               â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€                                                                    â”‚
â”‚                                                                                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| State | Style |
|-------|-------|
| **Default** | `--text-secondary`, no underline |
| **Active** | `--text-primary`, `--font-medium`, 2px accent underline |
| **Hover** | `--text-primary` |
| **Disabled** | `--text-muted`, no pointer |

| Property | Value |
|----------|-------|
| Font | `--text-sm`, `--font-medium` |
| Spacing | `--space-4` between tabs |
| Underline | 2px `--accent`, only on active |

---

### Breadcrumbs

Hierarchical navigation path.

```
ðŸ§‘â€ðŸš€ Acme Corp  â€º  ðŸ° Main Website  â€º  ðŸ¤ Website Redesign
```

| Element | Specification |
|---------|---------------|
| Segments | Icon + text, clickable except last |
| Separator | " â€º " (`--text-muted`) |
| Font | `--text-sm` |
| Current (last) | `--text-primary`, not clickable |
| Ancestors | `--text-secondary`, clickable |
| Truncation | Middle segments collapse to "..." |

**Truncation Example:**
```
ðŸ§‘â€ðŸš€ Acme Corp  â€º  ...  â€º  ðŸ¤ Website Redesign  â€º  âš”ï¸ Homepage Mockup
```

---

### Pagination

For navigating large lists.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                                â”‚
â”‚  â† Previous    1   2   [3]   4   5   ...   12    Next â†’                        â”‚
â”‚                                                                                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Style |
|---------|-------|
| Current page | Accent background, white text, `--radius-sm` |
| Other pages | No background, `--accent` text on hover |
| Previous/Next | Text links with arrows |
| Ellipsis | Non-interactive, `--text-muted` |

---

## 3. Data Display Components

### Badge

Small label for categorization or counts.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Label  â”‚   â”‚    5    â”‚   â”‚  New!   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Font | `--text-xs`, `--font-medium` |
| Padding | `--space-1` vertical, `--space-2` horizontal |
| Border radius | `--radius-sm` (4px) |

**Variants:**

| Variant | Background | Text | Use |
|---------|------------|------|-----|
| **Default** | `--bg-secondary` | `--text-secondary` | Neutral info |
| **Accent** | `--accent-subtle` | `--accent` | Counts, highlights |
| **Success** | `--success-subtle` | `--success` | Positive states |
| **Warning** | `--warning-subtle` | `--warning` | Alerts (NOT red) |

---

### StatusChip

Indicates entity status. More prominent than Badge.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  â— Ready     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Font | `--text-xs`, `--font-medium` |
| Padding | `--space-1` vertical, `--space-2` horizontal |
| Border radius | `--radius-full` (pill shape) |
| Dot | 6px circle, status color |

**Quest Statuses:**

| Status | Dot Color | Background |
|--------|-----------|------------|
| Ready | Green | `--success-subtle` |
| In Progress | Blue | `--accent-subtle` |
| In Review | Amber | `--warning-subtle` |
| Blocked | Gray | `--bg-secondary` |
| Done | Green | `--success-subtle` |

**Pact Statuses:**

| Status | Dot Color | Background |
|--------|-----------|------------|
| Planning | Blue | `--accent-subtle` |
| In Progress | Blue | `--accent-subtle` |
| On Hold | Amber | `--warning-subtle` |
| Complete | Green | `--success-subtle` |
| Archived | Gray | `--bg-secondary` |

**Patron Statuses:**

| Status | Dot Color | Background |
|--------|-----------|------------|
| Active | Green | `--success-subtle` |
| Inactive | Gray | `--bg-secondary` |
| Prospect | Blue | `--accent-subtle` |
| Archived | Gray | `--bg-secondary` |

---

### EnergyBadge

Shows task energy estimate with optional mystery factor.

```
Standard:        With mystery:       Unknown:
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  âš¡ 3   â”‚     â”‚  âš¡ 3~5     â”‚     â”‚  âš¡ ?   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Icon | âš¡ (lightning bolt) |
| Font | `--text-xs`, `--font-medium` |
| Color | `--accent` |
| Background | `--accent-subtle` |
| Border radius | `--radius-sm` |

**Variants:**

| Variant | Display | When |
|---------|---------|------|
| **Standard** | `âš¡ 3` | No mystery factor |
| **Range** | `âš¡ 3~5` | Has mystery factor (shows variance) |
| **Unknown** | `âš¡ ?` | Mystery factor = "No Idea" |

---

### Avatar

User representation.

```
â”Œâ”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”
â”‚ MH  â”‚     â”‚ ðŸ‘¤  â”‚     â”‚ IMG â”‚
â””â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”˜
Initials    Fallback    Image
```

| Size | Dimensions | Font |
|------|------------|------|
| **sm** | 24px | `--text-xs` |
| **md** | 32px | `--text-sm` |
| **lg** | 40px | `--text-base` |
| **xl** | 56px | `--text-lg` |

| Property | Value |
|----------|-------|
| Shape | Circle (`--radius-full`) |
| Background | `--accent` (for initials) |
| Text | White, centered |
| Fallback | Generic user icon when no image/initials |

---

### ProgressDots

Shows progress as filled/unfilled dots (used for Pact health).

```
â—â—â—â—‹â—‹     â—â—â—â—â—     â—‹â—‹â—‹â—‹â—‹
60%       100%      0%
```

| Property | Value |
|----------|-------|
| Dot count | 5 |
| Dot size | 8px |
| Spacing | 4px between |
| Filled | `--accent` |
| Unfilled | `--border` |

---

### ProgressBar

Shows progress as horizontal bar (used for retainer usage).

```
â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘    80%
â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ    100%
â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ!!  120% (over)
```

| Property | Value |
|----------|-------|
| Height | 6px |
| Border radius | `--radius-full` |
| Background (track) | `--bg-secondary` |
| Fill (normal) | `--accent` |
| Fill (warning 80%+) | `--warning` (muted gold) |
| Fill (over 100%) | `--warning` with "!!" text indicator |

**Important:** Never use red. Over-limit uses amber/gold with clear text explanation.

---

### Table

For displaying structured data.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Name               Patron          Status        PM          Progress         â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Website Redesign   Acme Corp       In Progress   Sarah       â—â—â—â—‹â—‹           â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Brand Identity     Beta Client     Planning      Sarah       â—â—â—‹â—‹â—‹           â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  Mobile App         Acme Corp       In Progress   Mike        â—â—â—â—â—‹           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Style |
|---------|-------|
| Header row | `--bg-secondary`, `--text-sm`, `--font-medium` |
| Body rows | `--bg-elevated`, border-bottom 1px `--border` |
| Row hover | `--bg-secondary` subtle |
| Cell padding | `--space-3` |
| Text alignment | Left (default), right for numbers |

---

### EmptyState

Shown when a section has no content.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚                           âœ¨                                    â”‚
â”‚                                                                 â”‚
â”‚                    All caught up!                               â”‚
â”‚            No quests assigned to you right now.                 â”‚
â”‚                                                                 â”‚
â”‚                     [Optional Action]                           â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Style |
|---------|-------|
| Icon | 32px, `--text-muted` |
| Title | `--text-base`, `--font-medium`, `--text-primary` |
| Description | `--text-sm`, `--text-secondary` |
| Action | Optional button or link |
| Alignment | Center |
| Padding | `--space-6` vertical |

**Common Empty States:**

| Context | Icon | Title | Description |
|---------|------|-------|-------------|
| No quests | âœ¨ | All caught up! | No quests assigned to you right now. |
| No reviews | âœ“ | No reviews pending | Your team's work is all reviewed. |
| No results | ðŸ” | No results found | Try adjusting your search or filters. |
| No retainer alerts | âœ“ | All retainers on track | No patrons approaching their allocation. |

---

### SkeletonLoader

Loading placeholder that mimics content shape.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘                        â”‚
â”‚  â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘                                                â”‚
â”‚                                                                 â”‚
â”‚  â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘                        â”‚
â”‚  â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘                                                â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Background | `--bg-secondary` |
| Animation | Subtle pulse (respects `prefers-reduced-motion`) |
| Border radius | `--radius-sm` |
| Height | Mimics actual content height |

---

## 4. Form Components

### TextInput

Standard text field.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  Label *                                                        â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚ Placeholder text                                          â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚  Helper text goes here                                          â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Label | `--text-sm`, `--font-medium`, always visible |
| Required indicator | " *" after label |
| Input height | 40px |
| Input padding | `--space-3` |
| Input font | `--text-base` |
| Border | 1px `--border` |
| Border radius | `--radius-sm` |
| Helper text | `--text-xs`, `--text-secondary` |
| Error text | `--text-xs`, `--warning` |

**States:**

| State | Border | Background | Notes |
|-------|--------|------------|-------|
| Default | `--border` | `--bg-elevated` | |
| Focus | `--accent` (2px) | `--bg-elevated` | Focus ring visible |
| Error | `--warning` | `--bg-elevated` | Error message shown |
| Disabled | `--border` | `--bg-secondary` | 50% opacity |

**Critical ND Requirement:** Labels must ALWAYS be visible. Never use placeholder-only inputsâ€”this overloads working memory.

---

### Select

Dropdown selection.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  Patron *                                                       â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚ Select a patron...                                    [â–¼] â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

Same styling as TextInput, with dropdown arrow indicator.

**Dropdown Open:**
```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ Acme Corp                                             [â–²] â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ ðŸ§‘â€ðŸš€ Acme Corp                                    Active   â”‚
â”‚ ðŸ§‘â€ðŸš€ Beta Client                                 Active   â”‚
â”‚ ðŸ§‘â€ðŸš€ Gamma Inc                                   Inactive â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### Checkbox

```
Default:         Checked:         Indeterminate:
â”Œâ”€â”€â”€â”€â”           â”Œâ”€â”€â”€â”€â”           â”Œâ”€â”€â”€â”€â”
â”‚    â”‚  Label    â”‚ âœ“  â”‚  Label    â”‚ â”€  â”‚  Label
â””â”€â”€â”€â”€â”˜           â””â”€â”€â”€â”€â”˜           â””â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Size | 18px |
| Border | 1px `--border` |
| Border radius | `--radius-sm` |
| Checked background | `--accent` |
| Check mark | White |
| Label spacing | `--space-2` from checkbox |

---

### Toggle

For on/off settings.

```
Off:                    On:
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”       â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ â—‹â”€â”€â”€â”€â”€â”€      â”‚       â”‚      â”€â”€â”€â”€â”€â”€â— â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜       â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Track width | 44px |
| Track height | 24px |
| Knob size | 20px |
| Off track | `--bg-secondary` |
| On track | `--accent` |
| Transition | 150ms (if motion allowed) |

---

### DatePicker

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  Due Date                                                       â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚ Dec 20, 2024                                        [ðŸ“…]  â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

Input styling matches TextInput. Calendar icon triggers date picker dropdown.

| Property | Value |
|----------|-------|
| Date format | "MMM D, YYYY" (e.g., "Dec 20, 2024") |
| Icon | Calendar (ðŸ“…) |
| Dropdown | Calendar grid picker |

---

### TextArea

Multi-line text input.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  Notes                                                          â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚                                                           â”‚  â”‚
â”‚  â”‚                                                           â”‚  â”‚
â”‚  â”‚                                                           â”‚  â”‚
â”‚  â”‚                                                           â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Min height | 80px |
| Resize | Vertical only |
| Other styles | Same as TextInput |

---

### FormSection

Groups related form fields.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  Basic Information                                              â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚                                                                 â”‚
â”‚  [Form fields here]                                             â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Title | `--text-base`, `--font-semibold` |
| Divider | 1px `--border` |
| Spacing | `--space-5` between sections |
| Field spacing | `--space-4` between fields |

---

## 5. Button Components

### Button

```
Primary:          Secondary:        Ghost:           Danger:
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚   Save    â”‚    â”‚  Cancel   â”‚    â”‚   Edit    â”‚    â”‚  Delete   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Variants:**

| Variant | Background | Text | Border | Use |
|---------|------------|------|--------|-----|
| **Primary** | `--accent` | White | None | Main actions |
| **Secondary** | `--bg-elevated` | `--text-primary` | 1px `--border` | Secondary actions |
| **Ghost** | Transparent | `--accent` | None | Tertiary actions |
| **Danger** | Transparent | `--warning` | 1px `--warning` | Destructive actions |

**Sizes:**

| Size | Height | Padding | Font |
|------|--------|---------|------|
| **sm** | 32px | `--space-2` horizontal | `--text-sm` |
| **md** | 40px | `--space-4` horizontal | `--text-sm` |
| **lg** | 48px | `--space-5` horizontal | `--text-base` |

**States:**

| State | Modification |
|-------|--------------|
| Hover | Slight darken (primary) / lighten (secondary) |
| Active | Slight scale down (if motion allowed) |
| Disabled | 50% opacity, cursor not-allowed |
| Loading | Spinner replaces text |

---

### IconButton

Button with icon only.

```
â”Œâ”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”    â”Œâ”€â”€â”€â”€â”€â”
â”‚  âœ•  â”‚    â”‚  â‹®  â”‚    â”‚  â–¶  â”‚
â””â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”˜    â””â”€â”€â”€â”€â”€â”˜
```

| Size | Dimensions |
|------|------------|
| **sm** | 28px Ã— 28px |
| **md** | 36px Ã— 36px |
| **lg** | 44px Ã— 44px |

| Property | Value |
|----------|-------|
| Border radius | `--radius-sm` |
| Background | Transparent (default) |
| Hover | `--bg-secondary` |

**Accessibility:** Must include `aria-label` for screen readers.

---

### ButtonGroup

Grouped related actions.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  [Approve]  [Return]  [View]          â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Spacing | `--space-2` between buttons |
| Alignment | Flex row |

Buttons in a group can share borders when using connected variant.

---

## 6. Feedback Components

### Toast

Notification that appears temporarily.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  âœ“  Quest saved successfully                           [âœ•]  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Position | Bottom-right, fixed |
| Width | Auto, max 400px |
| Background | `--bg-elevated` |
| Border radius | `--radius-md` |
| Shadow | `--shadow-lg` |
| Padding | `--space-3` |

**Variants:**

| Variant | Icon | Accent Color |
|---------|------|--------------|
| **Success** | âœ“ | `--success` |
| **Info** | â„¹ï¸ | `--accent` |
| **Warning** | âš ï¸ | `--warning` |
| **Error** | âš ï¸ | `--warning` (NOT red) |

**Behavior:**

| Aspect | Value |
|--------|-------|
| Duration | 5 seconds (default) |
| Dismissal | Always include close button |
| Animation | Fade in (respects `prefers-reduced-motion`) |
| Stacking | Max 3 visible; older compress to count |

---

### Alert

Inline alert within content.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  âš ï¸  You have 2 days without logged time this week.         â”‚
â”‚                                              [Add Time â†’]    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Border-left | 3px, variant color |
| Background | Variant subtle color |
| Padding | `--space-3` |
| Border radius | `--radius-sm` |

**Variants:**

| Variant | Border | Background |
|---------|--------|------------|
| **Info** | `--accent` | `--accent-subtle` |
| **Warning** | `--warning` | `--warning-subtle` |
| **Success** | `--success` | `--success-subtle` |

---

### Tooltip

Contextual hint on hover/focus.

```
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚ Energy estimate: 3  â”‚
                    â”‚ hours of work       â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                             â–¼
                          â”Œâ”€â”€â”€â”€â”€â”
                          â”‚ âš¡3 â”‚
                          â””â”€â”€â”€â”€â”€â”˜
```

| Property | Value |
|----------|-------|
| Background | `--text-primary` (inverted) |
| Text | `--bg-primary`, `--text-sm` |
| Padding | `--space-2` |
| Border radius | `--radius-sm` |
| Max width | 200px |
| Arrow | 6px triangle pointing to trigger |

**Behavior:**
- Delay: 300ms before showing
- Position: Auto (prefers top, adjusts to viewport)
- Trigger: Hover and focus

---

## 7. Domain-Specific Components

### QuestCard

Compact task display for dashboards and lists.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  âš”ï¸ Homepage Mockup                                    Ready    â”‚
â”‚     Acme Corp â€º Redesign                         âš¡ 3  ðŸ‘¤ MH    â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Component/Style |
|---------|-----------------|
| Icon | Entity icon (âš”ï¸), 16px |
| Name | `--text-base`, link style |
| Status | StatusChip |
| Breadcrumb | `--text-sm`, `--text-secondary` |
| Energy | EnergyBadge |
| Assignee | Avatar (sm) or initials |

**Variants:**

| Variant | Modification |
|---------|--------------|
| **Default** | As shown |
| **With timer** | Green pulse indicator on left |
| **Blocked** | ðŸš« icon, "Blocked by: [Task]" text |
| **With due date** | "Due Fri" badge after energy |

---

### QuestRow

Table-style for denser lists.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ â—‹  âš”ï¸  Homepage Mockup      Acme â€º Redesign     âš¡3   Ready    ðŸ‘¤MH   [â–¶]     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Description |
|---------|-------------|
| Checkbox | Optional, for bulk selection |
| Icon | Entity icon |
| Name | Quest name, link |
| Context | Breadcrumb, truncated if needed |
| Energy | EnergyBadge |
| Status | StatusChip |
| Assignee | Avatar initials |
| Action | Quick-start timer IconButton |

---

### PactCard

Project summary for dashboards.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  ðŸ¤ Website Redesign                    â—â—â—â—‹â—‹    In Progress    â”‚
â”‚     Acme Corp                               12/18 tasks done    â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Component/Style |
|---------|-----------------|
| Icon | Entity icon (ðŸ¤) |
| Name | `--text-base`, link style |
| Progress | ProgressDots |
| Status | StatusChip |
| Patron | `--text-sm`, `--text-secondary` |
| Task count | `--text-sm`, `--text-muted` |

---

### RetainerMeter

Shows retainer usage for a patron.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  ðŸ§‘â€ðŸš€ Acme Corp                                                  â”‚
â”‚     18h / 20h used (90%)                      â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘        â”‚
â”‚     2 hours remaining this month                                â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Component/Style |
|---------|-----------------|
| Icon | Entity icon (ðŸ§‘â€ðŸš€) |
| Name | `--text-base`, link style |
| Usage text | `--text-sm`, `--text-primary` |
| Bar | ProgressBar |
| Remaining | `--text-sm`, `--text-secondary` |

**Alert Thresholds:**

| Threshold | Display |
|-----------|---------|
| < 80% | Normal (accent color bar) |
| 80-99% | Warning (amber bar) |
| 100%+ | Over (amber bar with "!!" indicator) |

---

### TimerWidget

Active timer display with estimate-based progress visualization. The timer shows progress toward the task's energy estimate (low and high range) and indicates when time exceeds the estimate.

**Anatomy:**

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                         â”‚
â”‚          â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                  â”‚
â”‚         â•± â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘ â•²    â† Outer ring â”‚
â”‚        â”‚ â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚      (overflow, â”‚
â”‚        â”‚ â”‚           â”‚ â”‚       when over)â”‚
â”‚        â”‚ â”‚  1:23:45  â”‚ â”‚   â† Inner ring  â”‚
â”‚        â”‚ â”‚  Task...  â”‚ â”‚      (progress) â”‚
â”‚        â”‚ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚                 â”‚
â”‚         â•² â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘ â•±                  â”‚
â”‚          â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                   â”‚
â”‚                                         â”‚
â”‚  âš¡ 3~5 estimate                        â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€    â”‚
â”‚  Low    3h   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘  âœ“    â”‚
â”‚  High   5h   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘       â”‚
â”‚  Over  +45m  â–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘       â”‚
â”‚                                         â”‚
â”‚         [Pause]        [Stop]           â”‚
â”‚                                         â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Ring Dimensions:**

| Element | Value |
|---------|-------|
| Ring diameter | 120px |
| Inner ring thickness | 8px |
| Outer ring thickness | 4px |
| Gap between rings | 4px |
| Time font | `--text-3xl`, `--font-semibold` |
| Task name font | `--text-sm`, `--text-secondary` |

**Timer States:**

| State | Ring Display | Color | Text Display |
|-------|--------------|-------|--------------|
| **Under low estimate** | Inner ring shows progress toward LOW | `--accent` (blue) | Elapsed time only |
| **Mystery zone (low â†’ high)** | Inner ring full, continues toward HIGH | `--warning` (amber) | Elapsed time only |
| **Over high estimate** | Inner FULL + outer ring shows overflow | `--warning` (amber) | Elapsed + "+X:XX over" |
| **Way over (2x high)** | Both rings FULL + "!!" badge | `--warning` (amber) | Elapsed + "+X:XX over" + badge |
| **No timer running** | Empty ring (gray) | `--border` | "No timer running" |

**State 1: Under Low Estimate**

```
        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       â•±   â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘    â•²
      â”‚   â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘    â”‚
      â”‚                 â”‚      âš¡ 3~5 estimate
      â”‚    1:23:45      â”‚      â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      â”‚   Homepage...   â”‚      Low   3h  â–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘ 
      â”‚                 â”‚      High  5h  â–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘
      â”‚   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘   â”‚
       â•²   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ    â•±
        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

- Inner ring: Blue (`--accent`), progress toward low estimate
- Outer ring: Hidden
- Estimate bars: Show progress relative to each target

**State 2: Mystery Zone (Low â†’ High)**

```
        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       â•±   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ    â•²
      â”‚   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ  â”‚
      â”‚                 â”‚      âš¡ 3~5 estimate
      â”‚    3:45:00      â”‚      â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      â”‚   Homepage...   â”‚      Low   3h  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ  âœ“
      â”‚                 â”‚      High  5h  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘
      â”‚   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ  â”‚
       â•²   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ    â•±
        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

- Inner ring: Amber (`--warning`), progress toward high estimate
- Outer ring: Hidden
- Low bar: Full with checkmark âœ“

**State 3: Over High Estimate**

```
        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       â•±   â–“â–“â–“â–“â–‘â–‘â–‘â–‘â–‘â–‘   â•²      â† Outer ring (overflow)
      â•±  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â•²
     â”‚  â•± â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ â•²  â”‚
     â”‚ â”‚ â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ â”‚ â”‚    âš¡ 3~5 estimate
     â”‚ â”‚    5:45:00     â”‚ â”‚    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     â”‚ â”‚   +0:45 over   â”‚ â”‚    Low   3h  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ  âœ“
     â”‚ â”‚   Homepage...  â”‚ â”‚    High  5h  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ  âœ“
     â”‚  â•² â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ â•±  â”‚    Over +45m â–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘
      â•²  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â•±
       â•²   â–“â–“â–“â–“â–‘â–‘â–‘â–‘â–‘â–‘   â•±
        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

- Inner ring: Full, amber
- Outer ring: Visible, amber, shows progress toward 2x high estimate
- "+X:XX over" text below time
- Over bar: Appears, shows overflow amount

**State 4: Way Over (!!)**

```
        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       â•±   â–“â–“â–“â–“â–“â–“â–“â–“â–“â–“   â•²  !!  â† Badge
      â•±  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â•²
     â”‚  â•± â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ â•²  â”‚
     â”‚ â”‚ â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ â”‚ â”‚    âš¡ 3~5 estimate
     â”‚ â”‚    9:30:00     â”‚ â”‚    â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
     â”‚ â”‚   +4:30 over   â”‚ â”‚    Low   3h  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ  âœ“
     â”‚ â”‚   Homepage...  â”‚ â”‚    High  5h  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ  âœ“
     â”‚  â•² â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ â•±  â”‚    Over +4:30 â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ
      â•²  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â•±
       â•²   â–“â–“â–“â–“â–“â–“â–“â–“â–“â–“   â•±
        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

- Both rings: Full, amber
- "!!" badge: Appears in top-right corner (small amber pill)
- Indicates task has significantly exceeded estimate

**State 5: No Timer Running**

```
        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       â•±   â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘    â•²
      â”‚   â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘    â”‚
      â”‚                 â”‚
      â”‚   No timer      â”‚
      â”‚   running       â”‚
      â”‚                 â”‚
      â”‚   â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘    â”‚
       â•²   â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘    â•±
        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
        
        [â–¶ Start Timer]
```

- Ring: Empty, gray (`--border`)
- Single button to start timer

**Wide Range Example (High Mystery Factor):**

For tasks with "No Idea" mystery factor, the range is very wide but still displays the same way:

```
âš¡ 2~12 estimate
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Low    2h   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘  âœ“
High  12h   â–ˆâ–ˆâ–ˆâ–ˆâ–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘â–‘
```

The wide range is visible, setting appropriate expectations.

---

**Compact Timer (Header):**

Minimal display for the header bar.

```
Under estimate:      Mystery zone:        Over estimate:       Way over:
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ â±ï¸ 1:23 / ~3h  â”‚  â”‚ â±ï¸ 3:45 / ~5h ðŸŸ¡â”‚  â”‚ â±ï¸ 5:45 (+0:45) ðŸŸ¡â”‚  â”‚ â±ï¸ 9:30 (+4:30) ðŸŸ¡!!â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| State | Format | Indicator |
|-------|--------|-----------|
| Under low | `â±ï¸ {elapsed} / ~{low}` | None (or blue dot) |
| Mystery zone | `â±ï¸ {elapsed} / ~{high}` | ðŸŸ¡ amber dot |
| Over estimate | `â±ï¸ {elapsed} (+{over})` | ðŸŸ¡ amber dot |
| Way over | `â±ï¸ {elapsed} (+{over})` | ðŸŸ¡!! amber dot + badge |

| Element | Style |
|---------|-------|
| Container | Clickable, opens Timekeeper or full timer |
| Icon | â±ï¸ with status dot |
| Time | `--text-sm`, `--font-medium` |
| Estimate/Over | `--text-sm`, `--text-secondary` |

---

**Estimate Breakdown Panel:**

Shows below the ring in full timer widget.

| Element | Style |
|---------|-------|
| Header | `âš¡ {low}~{high} estimate`, `--text-sm` |
| Row labels | "Low", "High", "Over" â€” `--text-xs`, `--text-muted` |
| Row values | Time values â€” `--text-xs`, right-aligned |
| Progress bars | 100px Ã— 4px, `--radius-full` |
| Checkmark | âœ“ in `--accent` when exceeded |
| "Over" row | Only visible when over high estimate |

**Progress Bar Colors in Breakdown:**

| Row | Color |
|-----|-------|
| Low (incomplete) | `--accent` |
| Low (complete) | `--accent` + âœ“ |
| High (in progress) | `--warning` |
| High (complete) | `--warning` + âœ“ |
| Over | `--warning` |

---

**ND Considerations:**

| Principle | Implementation |
|-----------|----------------|
| **No anxiety colors** | Amber for all warnings/over states, never red |
| **Clear progress** | Visual rings + text + breakdown all show same info |
| **Learning framing** | Over-time is data for calibrating future estimates, not failure |
| **Explicit states** | Each state has distinct visual treatment |
| **Progressive disclosure** | Header shows minimal info; full widget shows detail |

---

### EntitySelector

Searchable dropdown for selecting entities (Patron, Site, Pact, Quest).

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  Patron *                                                       â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚
â”‚  â”‚ ðŸ” Search patrons...                                      â”‚  â”‚
â”‚  â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤  â”‚
â”‚  â”‚ ðŸ§‘â€ðŸš€ Acme Corp                                    Active   â”‚  â”‚
â”‚  â”‚ ðŸ§‘â€ðŸš€ Beta Client                                 Active   â”‚  â”‚
â”‚  â”‚ ðŸ§‘â€ðŸš€ Gamma Inc                                   Active   â”‚  â”‚
â”‚  â”‚ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚  â”‚
â”‚  â”‚ ðŸ§‘â€ðŸš€ Old Client                                  Inactive â”‚  â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Feature | Behavior |
|---------|----------|
| Search | Type-ahead filtering |
| Display | Icon, name, status for each option |
| Grouping | Active items first, then inactive |
| Keyboard | Arrow keys to navigate, Enter to select |
| Empty | "No results found" message |

---

### WhatsNextCard

Featured single-task recommendation for Tech dashboard.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  ðŸŽ¯ What's Next?                                                â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
â”‚                                                                 â”‚
â”‚  Recommended based on priority and deadlines:                   â”‚
â”‚                                                                 â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”    â”‚
â”‚  â”‚                                                         â”‚    â”‚
â”‚  â”‚  âš”ï¸ Contact Form Validation                    Ready    â”‚    â”‚
â”‚  â”‚     Acme Corp â€º Redesign               âš¡ 3   Due Fri   â”‚    â”‚
â”‚  â”‚                                                         â”‚    â”‚
â”‚  â”‚              [ â–¶ Start Working ]                        â”‚    â”‚
â”‚  â”‚                                                         â”‚    â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜    â”‚
â”‚                                                                 â”‚
â”‚  Skip this â†’ show me all my quests                              â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Style |
|---------|-------|
| Card | Featured variant (accent left border) |
| Header | Section header pattern |
| Description | `--text-sm`, `--text-secondary` |
| Inner card | Card (flush variant) containing quest |
| CTA button | Button (primary, lg) |
| Skip link | Ghost link, `--text-sm` |

---

### ReviewQueueItem

Task awaiting review with inline actions (for PM dashboard).

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                                                                 â”‚
â”‚  âš”ï¸ Homepage Mockup                         In Review   ðŸ‘¤ MH  â”‚
â”‚     Acme Corp â€º Redesign                       submitted 2h ago â”‚
â”‚                                                                 â”‚
â”‚                              [Approve]  [Return]  [View]        â”‚
â”‚                                                                 â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Style |
|---------|-------|
| Quest info | Same as QuestCard |
| Timestamp | `--text-sm`, `--text-muted`, "submitted X ago" |
| Actions | ButtonGroup |
| Approve | Button (primary, sm) |
| Return | Button (secondary, sm) |
| View | Button (ghost, sm) |

**Action Behaviors:**

| Action | Behavior |
|--------|----------|
| Approve | Moves quest to Done, shows success toast |
| Return | Opens modal for return notes, moves to Ready |
| View | Opens Quest in drawer |

---

### SummaryStatCard

Large number display for at-a-glance metrics.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                      â”‚
â”‚  ðŸ“‹                  â”‚
â”‚                      â”‚
â”‚        4             â”‚
â”‚                      â”‚
â”‚   quests need        â”‚
â”‚   your review        â”‚
â”‚                      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Style |
|---------|-------|
| Icon | 24px, `--text-muted` |
| Number | `--text-3xl`, `--font-semibold` |
| Label | `--text-sm`, `--text-secondary` |
| Card | Interactive variant (clickable) |

---

## Component Checklist

### Layout
- [x] Card (Default, Flush, Interactive, Featured)
- [x] Section
- [x] PageHeader
- [x] Modal (sm, md, lg)
- [x] Drawer (sm, md, lg)

### Navigation
- [x] Tabs
- [x] Breadcrumbs
- [x] Pagination

### Data Display
- [x] Badge (Default, Accent, Success, Warning)
- [x] StatusChip (per entity type)
- [x] EnergyBadge (Standard, Range, Unknown)
- [x] Avatar (sm, md, lg, xl)
- [x] ProgressDots
- [x] ProgressBar
- [x] Table
- [x] EmptyState
- [x] SkeletonLoader

### Forms
- [x] TextInput
- [x] Select
- [x] Checkbox
- [x] Toggle
- [x] DatePicker
- [x] TextArea
- [x] FormSection

### Buttons
- [x] Button (Primary, Secondary, Ghost, Danger Ã— sm, md, lg)
- [x] IconButton (sm, md, lg)
- [x] ButtonGroup

### Feedback
- [x] Toast (Success, Info, Warning, Error)
- [x] Alert (Info, Warning, Success)
- [x] Tooltip

### Domain-Specific
- [x] QuestCard
- [x] QuestRow
- [x] PactCard
- [x] RetainerMeter
- [x] TimerWidget (Compact, Full)
- [x] EntitySelector
- [x] WhatsNextCard
- [x] ReviewQueueItem
- [x] SummaryStatCard

---

## ND Principles Applied to Components

| Principle | Component Implementation |
|-----------|--------------------------|
| **Icons + labels** | All components pair icons with text; IconButton requires `aria-label` |
| **Visible labels** | Form inputs always show labels; never placeholder-only |
| **No red/anxiety** | StatusChip, ProgressBar, Toast use amber (`--warning`) for alerts, never red |
| **Predictable states** | Every component has defined states (default, hover, focus, disabled, error) |
| **Clear boundaries** | Cards, sections use borders and spacing for visual grouping |
| **Explicit feedback** | Toast for actions, Alert for inline warnings, clear EmptyState messages |
| **Reduced motion** | Animations optional; respects `prefers-reduced-motion` throughout |
| **Consistent sizing** | Defined size scales (sm, md, lg) used across all components |
| **Keyboard accessible** | All interactive components support keyboard navigation |

---

## Related Documents

- `indelible-wireframes-global-shell.md` â€” Global shell and navigation
- `indelible-wireframes-dashboards.md` â€” Dashboard wireframes
- `indelible-navigation-sitemap.md` â€” Navigation structure and routing
- `indelible-screen-inventory.md` â€” Complete screen catalog
- `Designing_a_Neurodivergent-Optimized_Project_Management_Interface.md` â€” ND design principles
