# Usability Round 2 — Accord Line Items Rework & Lead Editing

## Scope

This round restructures the Accord line item system from a single generic table into three distinct categories (Charters, Commissions, Keeps), fixes lead info editing, adds renewal tracking, and implements proper pricing flows.

**This work should be completed BEFORE Phases 7-9** (QuickBooks, Vacation Mode, Analytics) and ideally after Usability Round 1.

## Documents

| Document | Contents |
|----------|----------|
| `01-data-model-changes.md` | New line item tables, Keep entity, renewal tracking, Ware updates, legacy removal |
| `02-accord-screen-rework.md` | Three-section Accord UI, lead editing, pricing flows, site/project creation |
| `orchestration.md` | Execution instructions for the orchestrating agent |

## Priority Order

1. Data model changes (01) — schema, migration, API
2. Accord screen rework (02) — UI changes depending on new data model

## Important

- Do NOT begin Phases 7, 8, or 9 from the parent directory
- All existing tests must continue to pass at every step
- Sub-agents must be used for all implementation, testing, and impact analysis
