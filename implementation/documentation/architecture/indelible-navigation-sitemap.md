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
| Dashboard | Overlook | ðŸ”ï¸ | Role-specific home screen |
| Time Tracking | Timekeeper | â±ï¸ | Clock in/out, manual entry |
| Work Section | Foundry | ðŸ”¥ | Where client work happens |
| Projects | Pacts | ðŸ¤ | Agreements with patrons |
| Clients | Patrons | ðŸ§‘â€ðŸš€ | Direct, agency, sub-clients |
| Sites | Sites | ðŸ° | Web properties managed |
| Domains | Domains | ðŸ”— | DNS records (kept literal for clarity) |
| Tasks | Quests | âš”ï¸ | Individual units of work |
| Tools | Tools | âš’ï¸ | Plugins, licenses, software |
| Operations Section | Grimoire | ðŸ“– | Process documentation |
| SOPs | Runes | áš± | Individual procedures |
| Recipes | Rituals | ðŸ”® | Project blueprints |
| Services Section | Armory | âšœï¸ | Service offerings |
| Hosting Plans | Hosting | âš—ï¸ | Hosting tier definitions |
| Maintenance Plans | Maintenance | ðŸ›¡ï¸ | Maintenance tier definitions |
| Job Roles | Functions | ðŸ’¼ | Assignable skill roles |
| User Management | Team | ðŸ‘¥ | Admin user management |
| Reports | Reports | ðŸ“Š | System reports |

---

## Sidebar Navigation Structure

### Full Structure (Admin View)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ ðŸ”ï¸ Overlook             â”‚
â”‚ â±ï¸ Timekeeper           â”‚
â”‚                         â”‚
â”‚ â–¼ ðŸ”¥ Foundry            â”‚
â”‚    ðŸ¤ Pacts             â”‚
â”‚    ðŸ§‘â€ðŸš€ Patrons           â”‚
â”‚    ðŸ° Sites             â”‚
â”‚    ðŸ”— Domains           â”‚
â”‚    âš”ï¸ Quests            â”‚
â”‚    âš’ï¸ Tools             â”‚
â”‚                         â”‚
â”‚ â–¼ ðŸ“– Grimoire           â”‚
â”‚    áš± Runes              â”‚
â”‚    ðŸ”® Rituals           â”‚
â”‚                         â”‚
â”‚ â–¼ âšœï¸ Armory             â”‚
â”‚    âš—ï¸ Hosting           â”‚
â”‚    ðŸ›¡ï¸ Maintenance       â”‚
â”‚                         â”‚
â”‚ âš™ï¸ Settings             â”‚
â”‚ ðŸ” Admin                â”‚
â”‚    ðŸ‘¥ Team              â”‚
â”‚    ðŸ’¼ Functions         â”‚
â”‚    ðŸ“Š Reports           â”‚
â”‚ ðŸšª Logout               â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
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
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ [â˜°]  Indelible                    [ðŸ” Cmd+K]  [â±ï¸ 1:23:45]  [ðŸ”” 3]  [ðŸ‘¤] â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

| Element | Position | Function |
|---------|----------|----------|
| â˜° Hamburger | Left | Toggle sidebar collapse/expand |
| Logo/Title | Left | App branding |
| ðŸ” Search | Center-right | Global search (`Cmd+K`) |
| â±ï¸ Timer | Right | Active timer display (hidden if none) |
| ðŸ”” Notifications | Right | Unread count badge |
| ðŸ‘¤ User Menu | Right | Settings, logout |

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
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ ðŸ” Search...                            â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ ðŸ° Main Website                         â”‚
â”‚    Acme Corp                            â”‚
â”‚                                         â”‚
â”‚ âš”ï¸ Homepage Mockup                      â”‚
â”‚    Acme Corp > Main Website > Redesign  â”‚
â”‚                                         â”‚
â”‚ áš± Site Setup                            â”‚
â”‚    Runes                                â”‚
â”‚                                         â”‚
â”‚ ðŸ§‘â€ðŸš€ Acme Corp                            â”‚
â”‚    Patron                               â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## Overlook Layout (Desktop)

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ Header                                                                          â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚               â”‚                                                 â”‚               â”‚
â”‚   Sidebar     â”‚            Main Dashboard Content               â”‚   Recent      â”‚
â”‚   Navigation  â”‚                                                 â”‚   Items       â”‚
â”‚               â”‚   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚               â”‚
â”‚   Foundry     â”‚   â”‚  Role-specific widgets                  â”‚   â”‚   ðŸ° Site A   â”‚
â”‚   Grimoire    â”‚   â”‚  (Quests, Reviews, Retainers, etc.)     â”‚   â”‚   âš”ï¸ Quest B  â”‚
â”‚   Armory      â”‚   â”‚                                         â”‚   â”‚   ðŸ¤ Pact C   â”‚
â”‚   etc.        â”‚   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚   ðŸ§‘â€ðŸš€ Patron D â”‚
â”‚               â”‚                                                 â”‚               â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
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
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ [â˜°]  Acme Corp > Redesign    [ðŸ”” 3] â”‚  â† Simplified header
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                     â”‚
â”‚           Main Content              â”‚
â”‚                                     â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ ðŸ”ï¸    âš”ï¸    â±ï¸    ðŸ”    â˜°          â”‚  â† Bottom tabs
â”‚Over  Quest  Time  Search  More      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Bottom Tabs

| Tab | Icon | Function |
|-----|------|----------|
| Overlook | ðŸ”ï¸ | Dashboard home |
| Quests | âš”ï¸ | My quests (quick access) |
| Timekeeper | â±ï¸ | Time tracking |
| Search | ðŸ” | Global search |
| More | â˜° | Full navigation menu (drawer) |

### "More" Menu

Opens full sidebar navigation as overlay/drawer.

---

## Future Considerations

- **Favorites/Pinned Items:** Deferred to post-MVP
- **Additional Armory Services:** SEO packages, etc. will be added as new items under Armory