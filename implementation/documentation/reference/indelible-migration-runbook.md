# Indelible App: Migration Runbook
## Phase 4.1 Operational Planning Document

**Version:** 1.0  
**Date:** December 2024  
**Status:** â¬œ Not Started

---

## Overview

This runbook covers the one-time migration of foundation/reference data from Notion to the new Indelible PostgreSQL database. Projects, tasks, and time entries are **not** being migrated—the new system starts fresh for transactional data.

### Migration Approach

Rather than building runtime Notion API connectivity, we generate static SQL INSERT statements by extracting data from Notion in focused sessions. These SQL files become part of the codebase and run during initial database setup.

---

## What's Being Migrated

| Entity | Notion Database | PostgreSQL Table | Notes |
|--------|-----------------|------------------|-------|
| Functions | 🔼 Functions | `functions` | Job roles/capabilities |
| Hosting Plans | 💓 Hosting | `hosting_plans` | Plan tiers and pricing |
| Maintenance Plans | 📧 Maintenance Plans | `maintenance_plans` | Service tiers |
| Tools | 🧰 Tools | `tools` | Software catalog |
| Clients (Patrons) | 👨‍🚀 Clients | `clients` | Core CRM data |
| Agency Partners | 📡 Agency Partners | `clients` | Become `type = 'agency_partner'` |
| Sites | 🔸️ Sites | `sites` | Managed websites |
| Domains | 💨 Domains | `domains` | Domain names linked to sites |
| SOPs | 📋 SOPs | `sops` | Procedures (content as TipTap JSON) |
| Recipes | 👨‍🍳 Recipes | `recipes` | Manual recreation (only 2 exist) |

### What's NOT Being Migrated

| Entity | Reason |
|--------|--------|
| Projects | Starting fresh |
| Tasks | Starting fresh |
| Timeclock entries | Starting fresh |
| Meetings | Not needed for new system |
| Notes | Can be recreated as needed |
| Portal Affiliations | Deferred to post-MVP |

---

## Migration Order (Dependencies)

Entities must be migrated in this order due to foreign key relationships:

```
Phase 1: Independent Entities (no FK dependencies)
├── Functions
├── Hosting Plans
├── Maintenance Plans
└── Tools

Phase 2: Client Entities
├── Agency Partners → clients (type = 'agency_partner')
└── Clients → clients (with parent_agency_id where applicable)

Phase 3: Dependent Entities
├── Sites (references: clients, hosting_plans, maintenance_plans)
├── Domains (references: sites)
└── SOPs (references: functions)

Phase 4: Manual Recreation
└── Recipes (only 2, rebuild manually with phase/task structure)
```

---

## Notion Collection IDs Reference

| Database | Collection ID |
|----------|--------------|
| Clients | `d21c0ea2-caf5-4f2e-9512-0bc10eed1e83` |
| Sites | `ebc7cb3c-40b9-4d01-91bd-aacc89914d9e` |
| Domains | `7ff9269a-86a2-4c5b-836d-bd83672932ac` |
| Hosting | `88f15bcc-c851-4b7b-9c6d-2ec2e3eabe9a` |
| Maintenance Plans | `7e2e985b-a639-402e-91ae-b1c0f53a2c90` |
| SOPs | `1e2e607a-d424-806d-9106-000b8b7104d2` |
| Functions | `1e8e607a-d424-809c-99b7-000b0ffae667` |
| Recipes | `1d3e607a-d424-80a6-b139-000b19b0251e` |
| Agency Partners | `1bee607a-d424-8082-87c4-000b55c9cd6f` |

> **Note:** Tools collection ID needs to be located in Notion.

---

## Field Mappings by Entity

### Functions
| Notion Field | PostgreSQL Column | Transform |
|--------------|-------------------|-----------|
| Name | `name` | Direct |
| — | `department` | Default 'General', refine manually |
| — | `is_active` | Default `true` |

### Hosting Plans
| Notion Field | PostgreSQL Column | Transform |
|--------------|-------------------|-----------|
| Name | `name` | Direct |
| Rate | `client_rate` | Direct |
| Agency Rate | `agency_rate` | Direct |
| Monthly Cost | `monthly_cost` | Direct |
| Vendor Plan | `vendor_name` | Extract vendor |
| Details | `description` | Direct |
| Tags | `tags` | JSONB array |

### Maintenance Plans
| Notion Field | PostgreSQL Column | Transform |
|--------------|-------------------|-----------|
| Name | `name` | Direct |
| Rate | `client_rate` | Direct |
| Agency Rate | `agency_rate` | Direct |
| Hours | `hours_included` | Direct |
| — | `is_active` | Default `true` |

### Tools
| Notion Field | PostgreSQL Column | Transform |
|--------------|-------------------|-----------|
| Name | `name` | Direct |
| URL | `url` | Direct |
| Category | `category` | Direct |
| Notes | `description` | Direct |

### Agency Partners → Clients
| Notion Field | PostgreSQL Column | Transform |
|--------------|-------------------|-----------|
| Name | `name` | Direct |
| — | `type` | Set to `'agency_partner'` |
| — | `status` | Default `'active'` |

### Clients
| Notion Field | PostgreSQL Column | Transform |
|--------------|-------------------|-----------|
| Business | `name` | Direct |
| Contact Person | `contact_name` | Direct |
| Email Address | `contact_email` | Direct |
| Phone Number | `contact_phone` | Direct |
| Client Status | `status` | Map values (see below) |
| Hourly Rate | `hourly_rate` | Direct |
| Maint. Hrs. | `retainer_hours` | Direct |
| Contact Indicators | `notes` | Direct |
| Agency Partner link | `parent_agency_id` | Lookup UUID |
| — | `type` | `'direct'` or `'sub_client'` |

**Status Mapping:**
- Active → `'active'`
- Inactive → `'inactive'`
- Never Again → `'inactive'` (add note)
- Delinquent → `'delinquent'`

### Sites
| Notion Field | PostgreSQL Column | Transform |
|--------------|-------------------|-----------|
| Name | `name` | Direct |
| Client | `client_id` | Lookup UUID |
| Hosted By | `hosted_by` | Map to enum |
| Platform | `platform` | Direct |
| Hosting | `hosting_plan_id` | Lookup UUID |
| Maintenance Plan | `maintenance_plan_id` | Lookup UUID |
| Notes | `notes` | Direct |

### Domains
| Notion Field | PostgreSQL Column | Transform |
|--------------|-------------------|-----------|
| Name | `name` | Direct |
| Site | `site_id` | Lookup UUID |
| — | `registrar` | Null, populate later |
| — | `expires_at` | Null, populate later |

### SOPs
| Notion Field | PostgreSQL Column | Transform |
|--------------|-------------------|-----------|
| Name | `title` | Direct |
| Page content | `content` | Convert to TipTap JSON |
| Functions | `function_id` | Lookup UUID (first if multi) |
| Energy Impact | `estimated_minutes` | Hours Ã— 60 |
| Tags | `tags` | JSONB array |

---

## Extraction Process

Each entity is extracted in a separate Claude chat using the prompts in `indelible-migration-prompts.md`. The process:

1. Open fresh Claude chat with Notion MCP connected
2. Paste the appropriate extraction prompt
3. Claude queries Notion and generates SQL
4. Copy SQL output to `migrations/seed/XX-entity-name.sql`
5. Repeat for next entity

### Output File Structure

```
migrations/
└── seed/
    ├── 01-functions.sql
    ├── 02-hosting-plans.sql
    ├── 03-maintenance-plans.sql
    ├── 04-tools.sql
    ├── 05-agency-partners.sql
    ├── 06-clients.sql
    ├── 07-sites.sql
    ├── 08-domains.sql
    └── 09-sops.sql
```

### Running the Migration

```bash
# After schema migrations are applied
psql $DATABASE_URL -f migrations/seed/01-functions.sql
psql $DATABASE_URL -f migrations/seed/02-hosting-plans.sql
# ... etc, in order
```

Or combine into single file:
```bash
cat migrations/seed/*.sql > migrations/seed/all-seed-data.sql
psql $DATABASE_URL -f migrations/seed/all-seed-data.sql
```

---

## ID Mapping Strategy

Since PostgreSQL uses UUIDs and Notion uses its own IDs, we need to maintain mappings for foreign key resolution.

### Approach: Generate UUIDs During Extraction

Each extraction prompt generates deterministic UUIDs from Notion IDs using a consistent hash. This allows:
- FKs to be resolved within the same extraction session
- Re-running extraction produces same UUIDs
- No separate mapping table needed

### UUID Generation Formula

```sql
-- Deterministic UUID from Notion ID
-- Using MD5 hash formatted as UUID v4
SELECT uuid_generate_v5(uuid_ns_url(), 'notion:' || notion_id);
```

In practice, the extraction prompts will output pre-generated UUIDs.

---

## Post-Migration Tasks

### Immediate (After SQL runs)
- [ ] Verify record counts match Notion
- [ ] Spot-check a few records per table
- [ ] Verify FK relationships resolved

### Short-term (Week 1)
- [ ] Manually rebuild 2 Recipes with phase/task templates
- [ ] Review SOP content formatting in app
- [ ] Assign Functions to SOPs where missing
- [ ] Add domain expiration dates
- [ ] Add domain registrar info
- [ ] Assign departments to Functions

### Before Go-Live
- [ ] Create user accounts
- [ ] Test Recipe-based project creation end-to-end
- [ ] Verify billing rates display correctly

---

## Rollback

Since this is seed data for a fresh system:

```sql
-- Nuclear option: truncate all tables and re-run
TRUNCATE functions, hosting_plans, maintenance_plans, tools, 
         clients, sites, domains, sops CASCADE;
-- Then re-run seed files
```

---

## Related Documents

- `indelible-migration-prompts.md` — Copy-paste prompts for each extraction
- `indelible-data-model-refinement.md` — PostgreSQL schema definitions
- `notion-schema.md` — Original Notion database schema

---
