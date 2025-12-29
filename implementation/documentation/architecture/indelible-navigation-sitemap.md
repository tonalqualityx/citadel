# Indelible App: Navigation & Site Map
## Phase 1.1 Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** âœ… Complete

---

## Overview

This document defines the navigation architecture for Indelible, including the sidebar structure, naming conventions, breadcrumb logic, role-based variations, and mobile approach.

---

## Naming Glossary

The application uses thematic naming to create a cohesive, memorable experience.

| System Term | Display Name | Icon | Notes |
|-------------|--------------|------|-------|
| Dashboard | Overlook | 🗂️ | Role-specific home screen |
| Time Tracking | Timekeeper | â±️ | Clock in/out, manual entry |
| Work Section | Foundry | 📥 | Where client work happens |
| Projects | Pacts | 💝 | Agreements with patrons |
| Clients | Patrons | 👨‍🚀 | Direct, agency, sub-clients |
| Sites | Sites | 🏰 | Web properties managed |
| Domains | Domains | 💨 | DNS records (kept literal for clarity) |
| Tasks | Quests | âš”️ | Individual units of work |
| Tools | Tools | âš’️ | Plugins, licenses, software |
| Operations Section | Grimoire | 📓 | Process documentation |
| SOPs | Runes | áš± | Individual procedures |
| Recipes | Rituals | 📮 | Project blueprints |
| Services Section | Armory | âšœ️ | Service offerings |
| Hosting Plans | Hosting | âš—️ | Hosting tier definitions |
| Maintenance Plans | Maintenance | 🛠¡️ | Maintenance tier definitions |
| Job Roles | Functions | 🔼 | Assignable skill roles |
| User Management | Team | 💥 | Admin user management |
| Reports | Reports | 📰 | System reports |

---

## Sidebar Navigation Structure

### Full Structure (Admin View)

```
â”Œ─────────────────────────â”
│ 🗂️ Overlook             │
│ â±️ Timekeeper           │
│                         │
│ ▼ 📥 Foundry            │
│    💝 Pacts             │
│    👨‍🚀 Patrons           │
│    🏰 Sites             │
│    💨 Domains           │
│    âš”️ Quests            │
│    âš’️ Tools             │
│                         │
│ ▼ 📓 Grimoire           │
│    áš± Runes              │
│    📮 Rituals           │
│                         │
│ ▼ âšœ️ Armory             │
│    âš—️ Hosting           │
│    🛠¡️ Maintenance       │
│                         │
│ âš™️ Settings             │
│ 📐 Admin                │
│    💥 Team              │
│    🔼 Functions         │
│    📰 Reports           │
│ 🚪 Logout               │
└─────────────────────────â”˜
```

### Sidebar Behavior

- **Collapsible:** Can be minimized or expanded
- **Top-level navigation:** Links to list views
- **Sub-sections:** Collapse/expand (Foundry, Grimoire, Armory, Admin)
- **Persistent:** Visible on all authenticated pages (desktop)

---

## Role-Based Navigation

### Tech View

| Area | Access |
|------|--------|
| Overlook | âœ“ Tech dashboard |
| Timekeeper | âœ“ Full access |
| Foundry | âœ“ View all, work assigned quests |
| Patron rates | âŒ Hidden |
| Grimoire | âœ“ View only |
| Armory | âœ“ View (no margins/costs) |
| Settings | âœ“ Own preferences only |
| Admin | âŒ Hidden |

### PM View

| Area | Access |
|------|--------|
| Overlook | âœ“ PM dashboard |
| Timekeeper | âœ“ Full access |
| Foundry | âœ“ Full (manage own pacts) |
| Patron rates | âœ“ Visible |
| Grimoire | âœ“ Create/edit |
| Armory | âœ“ View (no margins/costs) |
| Settings | âœ“ Own preferences only |
| Admin | âŒ Hidden |

### Admin View

| Area | Access |
|------|--------|
| All areas | âœ“ Full access |
| Patron rates | âœ“ Visible |
| Armory margins/costs | âœ“ Visible |
| Admin section | âœ“ Visible |

---

## Breadcrumb Logic

Breadcrumbs provide context without overwhelming. Foundry items always start from Patron level.

### Foundry Items

| Context | Breadcrumb |
|---------|------------|
| Viewing a Patron | `Acme Corp` |
| Viewing a Site | `Acme Corp > Main Website` |
| Viewing a Domain | `Acme Corp > Main Website > acmecorp.com` |
| Viewing a Pact (with site) | `Acme Corp > Main Website > Website Redesign` |
| Viewing a Pact (no site) | `Acme Corp > Brand Strategy` |
| Viewing a Quest (from pact) | `Acme Corp > Main Website > Website Redesign > Homepage Mockup` |
| Viewing a Quest (ad hoc, site only) | `Acme Corp > Main Website > Fix Contact Form` |
| Viewing a Quest (ad hoc, patron only) | `Acme Corp > Logo Feedback` |
| Viewing a Tool | `Tools > WP Migrate Pro` |

### Grimoire Items

| Context | Breadcrumb |
|---------|------------|
| Viewing a Rune | `Runes > Site Setup` |
| Viewing a Ritual | `Rituals > Accelerated Site` |

### Armory Items

| Context | Breadcrumb |
|---------|------------|
| Viewing a Hosting Plan | `Hosting > Pro Plan` |
| Viewing a Maintenance Plan | `Maintenance > Standard` |

---

## Header Bar

```
â”Œ─────────────────────────────────────────────────────────────────────────â”
│ [â˜°]  Indelible                    [🔍 Cmd+K]  [â±️ 1:23:45]  [📝 3]  [💤] │
└─────────────────────────────────────────────────────────────────────────â”˜
```

| Element | Position | Function |
|---------|----------|----------|
| â˜° Hamburger | Left | Toggle sidebar collapse/expand |
| Logo/Title | Left | App branding |
| 🔍 Search | Center-right | Global search (`Cmd+K`) |
| â±️ Timer | Right | Active timer display (hidden if none) |
| 📝 Notifications | Right | Unread count badge |
| 💤 User Menu | Right | Settings, logout |

### Active Timer Behavior

- Hidden when no timer is running
- Shows elapsed time when active (e.g., `1:23:45`)
- Click to open Timekeeper or navigate to current quest

---

## Global Search (`Cmd+K`)

### Behavior

- Searches everything user has access to
- Role-filtered (Tech won't see rates, etc.)
- Keyboard shortcut: `Cmd+K` (Mac) / `Ctrl+K` (Windows)

### Results Display

Results show entity icon, name, and breadcrumb context:

```
â”Œ─────────────────────────────────────────â”
│ 🔍 Search...                            │
├─────────────────────────────────────────â”¤
│ 🏰 Main Website                         │
│    Acme Corp                            │
│                                         │
│ âš”️ Homepage Mockup                      │
│    Acme Corp > Main Website > Redesign  │
│                                         │
│ áš± Site Setup                            │
│    Runes                                │
│                                         │
│ 👨‍🚀 Acme Corp                            │
│    Patron                               │
└─────────────────────────────────────────â”˜
```

---

## Overlook Layout (Desktop)

```
â”Œ─────────────────────────────────────────────────────────────────────────────────â”
│ Header                                                                          │
├───────────────â”¬─────────────────────────────────────────────────â”¬───────────────â”¤
│               │                                                 │               │
│   Sidebar     │            Main Dashboard Content               │   Recent      │
│   Navigation  │                                                 │   Items       │
│               │   â”Œ─────────────────────────────────────────â”   │               │
│   Foundry     │   │  Role-specific widgets                  │   │   🏰 Site A   │
│   Grimoire    │   │  (Quests, Reviews, Retainers, etc.)     │   │   âš”️ Quest B  │
│   Armory      │   │                                         │   │   💝 Pact C   │
│   etc.        │   └─────────────────────────────────────────â”˜   │   👨‍🚀 Patron D │
│               │                                                 │               │
└───────────────â”´─────────────────────────────────────────────────â”´───────────────â”˜
```

### Recent Items Sidebar

- Position: Right side of Overlook only
- Shows recently viewed entities
- Quick navigation to recent work

---

## Mobile Navigation

### Approach

Bottom tab bar for primary actions + hamburger for full menu.

### Layout

```
â”Œ─────────────────────────────────────â”
│ [â˜°]  Acme Corp > Redesign    [📝 3] │  ← Simplified header
├─────────────────────────────────────â”¤
│                                     │
│           Main Content              │
│                                     │
├─────────────────────────────────────â”¤
│ 🗂️    âš”️    â±️    🔍    â˜°          │  ← Bottom tabs
│Over  Quest  Time  Search  More      │
└─────────────────────────────────────â”˜
```

### Bottom Tabs

| Tab | Icon | Function |
|-----|------|----------|
| Overlook | 🗂️ | Dashboard home |
| Quests | âš”️ | My quests (quick access) |
| Timekeeper | â±️ | Time tracking |
| Search | 🔍 | Global search |
| More | â˜° | Full navigation menu (drawer) |

### "More" Menu

Opens full sidebar navigation as overlay/drawer.

---

## Future Considerations

- **Favorites/Pinned Items:** Deferred to post-MVP
- **Additional Armory Services:** SEO packages, etc. will be added as new items under Armory